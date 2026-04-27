import { Module, Controller, Get, Post, Patch, Body, UseGuards, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IsNumber } from 'class-validator';

export class OpenRegisterDto { @IsNumber() openingBalance!: number; }

@Injectable()
export class CashRegisterService {
  constructor(private prisma: PrismaService) {}
  async getToday() {
    const todayStr = new Date().toISOString().split('T')[0];
    const today = new Date(todayStr);
    let r = await this.prisma.cashRegister.findUnique({ where: { date: today } });
    if (!r) r = await this.prisma.cashRegister.create({ data: { date: today, openingBalance: 0 } });
    return r;
  }
  async open(dto: OpenRegisterDto) {
    const todayStr = new Date().toISOString().split('T')[0];
    return this.prisma.cashRegister.upsert({
      where: { date: new Date(todayStr) },
      update: { openingBalance: dto.openingBalance },
      create: { date: new Date(todayStr), openingBalance: dto.openingBalance }
    });
  }
  async close(user: any) {
    return this.prisma.$transaction(async tx => {
      const todayStr = new Date().toISOString().split('T')[0];
      const r = await tx.cashRegister.findUnique({ where: { date: new Date(todayStr) } });
      if (!r || r.isClosedForDay) return r;
      const closingBalance = Number(r.openingBalance) + Number(r.cashIn) - Number(r.cashOut);
      return tx.cashRegister.update({
        where: { id: r.id },
        data: { closingBalance, isClosedForDay: true, closedById: user.id, closedAt: new Date() }
      });
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
  @Post('open') open(@Body() d: OpenRegisterDto) { return this.s.open(d); }
  @Patch('close') close(@CurrentUser() u: any) { return this.s.close(u); }
}
@Module({ providers: [CashRegisterService], controllers: [CashRegisterController] })
export class CashRegisterModule {}
