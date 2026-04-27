import { Module, Controller, Get, Post, Body, UseGuards, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IsNumber } from 'class-validator';

export class UpdateRatesDto { @IsNumber() milkRate!: number; @IsNumber() yogurtRate!: number; }

@Injectable()
export class DailyRatesService {
  constructor(private p: PrismaService) {}
  async getToday() {
    const td = new Date().toISOString().split('T')[0];
    const r = await this.p.dailyRate.findUnique({ where: { date: new Date(td) }});
    if (r) return r;
    return this.p.dailyRate.findFirst({ orderBy: { date: 'desc' } });
  }
  async setToday(d: UpdateRatesDto, u: any) {
    const tdStr = new Date().toISOString().split('T')[0];
    const td = new Date(tdStr);
    return this.p.dailyRate.upsert({
      where: { date: td },
      update: { milkRate: d.milkRate, yogurtRate: d.yogurtRate, updatedById: u.id },
      create: { date: td, milkRate: d.milkRate, yogurtRate: d.yogurtRate, updatedById: u.id }
    });
  }
}

@ApiTags('daily-rates')
@Controller('daily-rates')
@UseGuards(JwtAuthGuard)
export class DailyRatesController {
  constructor(private s: DailyRatesService) {}
  @Get('today') getToday() { return this.s.getToday(); }
  @Roles('ADMIN', 'MANAGER') @Post() setToday(@Body() d: UpdateRatesDto, @CurrentUser() u: any) { return this.s.setToday(d, u); }
}
@Module({ providers: [DailyRatesService], controllers: [DailyRatesController] })
export class DailyRatesModule {}
