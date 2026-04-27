import { Module, Controller, Get, Post, Body, UseGuards, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { IsNumber, IsString, IsEnum } from 'class-validator';

export class AdjustmentDto {
  @IsString() customerId!: string;
  @IsNumber() amount!: number;
  @IsEnum(['DEBIT', 'CREDIT']) type!: 'DEBIT'|'CREDIT';
  @IsString() description!: string;
}

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}
  async getSummary() {
    const res = await this.prisma.customer.aggregate({
      where: { currentBalance: { gt: 0 } },
      _sum: { currentBalance: true }
    });
    return { totalOutstanding: res._sum.currentBalance || 0 };
  }
  async addAdjustment(d: AdjustmentDto) {
    return this.prisma.$transaction(async tx => {
      const c = await tx.customer.findUnique({ where: { id: d.customerId } });
      if (!c) throw new Error('Not found');
      const amt = d.type === 'DEBIT' ? d.amount : -d.amount;
      const nb = Number(c.currentBalance) + amt;
      await tx.customer.update({ where: { id: c.id }, data: { currentBalance: nb } });
      return tx.ledgerEntry.create({
        data: { customerId: c.id, entryType: 'ADJUSTMENT', amount: amt, balanceAfter: nb, description: d.description }
      });
    });
  }
}

@ApiTags('ledger')
@Controller('ledger')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LedgerController {
  constructor(private readonly s: LedgerService) {}
  @Roles('ADMIN', 'MANAGER') @Get('summary') getSummary() { return this.s.getSummary(); }
  @Roles('ADMIN') @Post('adjustment') addAdjustment(@Body() d: AdjustmentDto) { return this.s.addAdjustment(d); }
}
@Module({ providers: [LedgerService], controllers: [LedgerController] })
export class LedgerModule {}
