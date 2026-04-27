import { BadRequestException, Module, Controller, Get, Post, Patch, Body, UseGuards, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IsNumber } from 'class-validator';
import { randomUUID } from 'crypto';

export class OpenRegisterDto { @IsNumber() openingBalance!: number; }

@Injectable()
export class CashRegisterService {
  constructor(private prisma: PrismaService) {}

  private getPakistanBusinessDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  }

  private async getOpenShift(tx: Pick<PrismaService, 'shift'> = this.prisma) {
    return tx.shift.findFirst({
      where: { status: 'OPEN' },
      orderBy: { openedAt: 'desc' }
    });
  }

  private async getOrCreateRegisterForShift(shift: { id: string; shiftDate: Date; openingCash: any }) {
    return this.prisma.cashRegister.upsert({
      where: { shiftId: shift.id },
      update: {},
      create: {
        shiftId: shift.id,
        date: shift.shiftDate,
        openingBalance: shift.openingCash
      }
    });
  }

  async getToday() {
    const shift = await this.getOpenShift();
    if (!shift) {
      throw new BadRequestException('No open shift found. Please open a shift before using the cash register.');
    }
    return this.getOrCreateRegisterForShift(shift);
  }

  async open(dto: OpenRegisterDto, user: any) {
    return this.prisma.$transaction(async tx => {
      const openShift = await this.getOpenShift(tx);
      const shift = openShift || await tx.shift.create({
        data: {
          id: randomUUID(),
          shiftDate: this.getPakistanBusinessDate(),
          openedById: user.id,
          openedAt: new Date(),
          openingCash: dto.openingBalance,
          expectedCash: dto.openingBalance,
          status: 'OPEN'
        }
      });

      return tx.cashRegister.upsert({
        where: { shiftId: shift.id },
        update: {
          openingBalance: dto.openingBalance
        },
        create: {
          shiftId: shift.id,
          date: shift.shiftDate,
          openingBalance: dto.openingBalance
        }
      });
    });
  }
  async close(user: any) {
    return this.prisma.$transaction(async tx => {
      const shift = await this.getOpenShift(tx);
      if (!shift) {
        throw new BadRequestException('No open shift found to close.');
      }
      const r = await tx.cashRegister.findUnique({ where: { shiftId: shift.id } });
      if (!r || r.isClosedForDay) return r;
      const closingBalance = Number(r.openingBalance) + Number(r.cashIn) - Number(r.cashOut);
      const closedRegister = await tx.cashRegister.update({
        where: { id: r.id },
        data: { closingBalance, isClosedForDay: true, closedById: user.id, closedAt: new Date() }
      });

      await tx.shift.update({
        where: { id: shift.id },
        data: {
          closedById: user.id,
          closedAt: new Date(),
          expectedCash: closingBalance,
          closingCash: closingBalance,
          cashVariance: 0,
          status: 'CLOSED'
        }
      });

      return closedRegister;
    });
  }
}

@ApiTags('cash-register')
@Controller('cash-register')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER')
export class CashRegisterController {
  constructor(private readonly s: CashRegisterService) {}
  @Get('today') getToday() { return this.s.getToday(); }
  @Post('open') open(@Body() d: OpenRegisterDto, @CurrentUser() u: any) { return this.s.open(d, u); }
  @Patch('close') close(@CurrentUser() u: any) { return this.s.close(u); }
}
@Module({ providers: [CashRegisterService], controllers: [CashRegisterController] })
export class CashRegisterModule {}
