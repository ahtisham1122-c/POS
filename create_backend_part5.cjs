const fs = require('fs');
const path = require('path');

function create(fp, content) {
  const fullPath = path.join(process.cwd(), fp);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trim() + '\n');
}

create('noon-dairy-backend/src/inventory/inventory.module.ts', `
import { Module, Controller, Get, UseGuards, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}
  async getSummary() {
    const products = await this.prisma.product.findMany({ where: { isActive: true }});
    let stockValue = 0;
    let lowStock = 0;
    let outOfStock = 0;
    for (const p of products) {
      stockValue += Number(p.stock) * Number(p.costPrice);
      if (Number(p.stock) <= 0) outOfStock++;
      else if (Number(p.stock) <= Number(p.lowStockThreshold)) lowStock++;
    }
    return { productsCount: products.length, stockValue, lowStockCount: lowStock, outOfStockCount: outOfStock };
  }
}

@ApiTags('inventory')
@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly s: InventoryService) {}
  @Roles('ADMIN', 'MANAGER', 'STAFF') @Get('summary') getSummary() { return this.s.getSummary(); }
}
@Module({ providers: [InventoryService], controllers: [InventoryController] })
export class InventoryModule {}
`);

create('noon-dairy-backend/src/expenses/expenses.module.ts', `
import { Module, Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { CodeGeneratorService } from '../code-generator/code-generator.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ExpenseCategory } from '@prisma/client';
import { IsString, IsEnum, IsNumber, IsOptional } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateExpenseDto {
  @IsString() expenseDate!: string;
  @IsEnum(ExpenseCategory) category!: ExpenseCategory;
  @IsString() description!: string;
  @IsNumber() amount!: number;
}

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService, private gen: CodeGeneratorService) {}
  async create(dto: CreateExpenseDto, user: any) {
    return this.prisma.$transaction(async tx => {
      const code = await this.gen.generate(tx, 'expense', 'code', 'EXP', 4);
      const e = await tx.expense.create({
        data: { ...dto, expenseDate: new Date(dto.expenseDate), createdById: user.id, code }
      });
      const cr = await tx.cashRegister.findFirst({ where: { isClosedForDay: false }, orderBy: { date: 'desc' } });
      if (cr) await tx.cashRegister.update({ where: { id: cr.id }, data: { cashOut: { increment: dto.amount } } });
      return e;
    });
  }
  async findAll() { return this.prisma.expense.findMany({ orderBy: { expenseDate: 'desc' }, take: 50 }); }
}

@ApiTags('expenses')
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER')
export class ExpensesController {
  constructor(private readonly s: ExpensesService) {}
  @Post() create(@Body() dto: CreateExpenseDto, @CurrentUser() u: any) { return this.s.create(dto, u); }
  @Get() findAll() { return this.s.findAll(); }
}
@Module({ providers: [ExpensesService], controllers: [ExpensesController] })
export class ExpensesModule {}
`);

create('noon-dairy-backend/src/cash-register/cash-register.module.ts', `
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
`);

create('noon-dairy-backend/src/ledger/ledger.module.ts', `
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
`);

// Adding missing daily rates to fix import loop errors
create('noon-dairy-backend/src/daily-rates/daily-rates.module.ts', `
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
`);

// Finally update AppModule
create('noon-dairy-backend/src/app.module.ts', `
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CodeGeneratorModule } from './code-generator/code-generator.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { DailyRatesModule } from './daily-rates/daily-rates.module';
import { CustomersModule } from './customers/customers.module';
import { LedgerModule } from './ledger/ledger.module';
import { SalesModule } from './sales/sales.module';
import { InventoryModule } from './inventory/inventory.module';
import { ExpensesModule } from './expenses/expenses.module';
import { CashRegisterModule } from './cash-register/cash-register.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CodeGeneratorModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    DailyRatesModule,
    CustomersModule,
    LedgerModule,
    SalesModule,
    InventoryModule,
    ExpensesModule,
    CashRegisterModule
  ],
})
export class AppModule {}
`);

console.log("Part 5 created. Backend fully mapped.");
