import { Module, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { CodeGeneratorService } from '../code-generator/code-generator.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { IsString, IsNumber, IsOptional } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateCustomerDto {
  @IsString() name!: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() address?: string;
  @IsString() @IsOptional() cardNumber?: string;
  @IsNumber() @IsOptional() openingBalance?: number;
  @IsNumber() @IsOptional() creditLimit?: number;
}
export class UpdateCustomerDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() address?: string;
  @IsString() @IsOptional() cardNumber?: string;
  @IsNumber() @IsOptional() creditLimit?: number;
}
export class CollectPaymentDto {
  @IsNumber() amount!: number;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() paymentDate?: string;
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService, private generator: CodeGeneratorService) {}

  async findAll(search?: string, hasBalance?: boolean) {
    return this.prisma.customer.findMany({
      where: {
        isActive: true,
        name: search ? { contains: search, mode: 'insensitive' } : undefined,
        currentBalance: hasBalance ? { not: 0 } : undefined,
      },
      orderBy: { name: 'asc' }
    });
  }

  async findOne(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id }});
    if (!c) throw new NotFoundException({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    return c;
  }

  async create(dto: CreateCustomerDto) {
    return this.prisma.$transaction(async tx => {
      const code = await this.generator.generate(tx, 'customer', 'code', 'CUST', 3);
      const c = await tx.customer.create({
        data: {
          code, name: dto.name, phone: dto.phone, address: dto.address,
          cardNumber: dto.cardNumber, creditLimit: dto.creditLimit || 0,
          currentBalance: dto.openingBalance || 0
        }
      });
      if (dto.openingBalance && dto.openingBalance !== 0) {
        await tx.ledgerEntry.create({
          data: {
            customerId: c.id, entryType: 'ADJUSTMENT', amount: dto.openingBalance,
            balanceAfter: dto.openingBalance, description: 'Opening Balance'
          }
        });
      }
      return c;
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const c = await this.findOne(id);
    if (Number(c.currentBalance) !== 0) {
      throw new BadRequestException({ error: 'CUSTOMER_HAS_OUTSTANDING_BALANCE', message: 'Cannot delete customer with non-zero balance' });
    }
    return this.prisma.customer.update({ where: { id }, data: { isActive: false } });
  }

  async getLedger(id: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { customerId: id },
      orderBy: { entryDate: 'desc' },
      take: 50,
      include: { sale: { select: { billNumber: true } } }
    });
  }

  async collectPayment(id: string, dto: CollectPaymentDto, user: any) {
    return this.prisma.$transaction(async tx => {
      const c = await tx.customer.findUnique({ where: { id } });
      if (!c) throw new NotFoundException();
      const newBal = Number(c.currentBalance) - dto.amount;

      const pmt = await tx.payment.create({
        data: {
          customerId: id, amount: dto.amount,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
          collectedById: user.id, notes: dto.notes
        }
      });

      await tx.customer.update({ where: { id }, data: { currentBalance: newBal } });

      await tx.ledgerEntry.create({
        data: {
          customerId: id, paymentId: pmt.id, entryType: 'PAYMENT_RECEIVED',
          amount: -dto.amount, balanceAfter: newBal, description: dto.notes || 'Payment Received'
        }
      });
      
      const cr = await tx.cashRegister.findFirst({ where: { isClosedForDay: false }, orderBy: { date: 'desc' } });
      if (cr) {
        await tx.cashRegister.update({ where: { id: cr.id }, data: { cashIn: { increment: dto.amount } } });
      }

      return { paymentId: pmt.id, balance: newBal };
    });
  }
}

@ApiTags('customers')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly service: CustomersService) {}
  @Roles('ADMIN', 'MANAGER', 'CASHIER') @Get() findAll(@Query('search') s: string, @Query('hasBalance') b: string) { return this.service.findAll(s, b === 'true'); }
  @Roles('ADMIN', 'MANAGER', 'CASHIER') @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Roles('ADMIN', 'MANAGER', 'CASHIER') @Get(':id/ledger') getLedger(@Param('id') id: string) { return this.service.getLedger(id); }
  @Roles('ADMIN', 'MANAGER', 'CASHIER') @Post() create(@Body() dto: CreateCustomerDto) { return this.service.create(dto); }
  @Roles('ADMIN', 'MANAGER', 'CASHIER') @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) { return this.service.update(id, dto); }
  @Roles('ADMIN', 'MANAGER') @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
  @Roles('ADMIN', 'MANAGER') @Post(':id/collect-payment') collectPayment(@Param('id') id: string, @Body() dto: CollectPaymentDto, @CurrentUser() u: any) { return this.service.collectPayment(id, dto, u); }
}

@Module({ providers: [CustomersService], controllers: [CustomersController] })
export class CustomersModule {}
