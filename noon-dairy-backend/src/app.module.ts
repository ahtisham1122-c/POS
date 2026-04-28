import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
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
import { SyncModule } from './sync/sync.module';
import { RolesModule } from './roles/roles.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 300 requests per minute per IP — protects sync endpoint from runaway loops
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
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
    CashRegisterModule,
    SyncModule,
    RolesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
