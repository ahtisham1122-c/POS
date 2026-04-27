const fs = require('fs');
const path = require('path');

function create(fp, content) {
  const fullPath = path.join(process.cwd(), fp);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trim() + '\n');
}

create('noon-dairy-backend/src/customers/customers.module.ts', `
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
`);

create('noon-dairy-backend/src/sales/sales.module.ts', `
import { Module, Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaymentType, DiscountType, SaleStatus } from '@prisma/client';
import { IsString, IsEnum, IsNumber, IsOptional, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class SaleItemDto {
  @IsString() productId!: string;
  @IsNumber() quantity!: number;
  @IsNumber() unitPrice!: number;
}
export class CreateSaleDto {
  @IsString() @IsOptional() customerId?: string;
  @IsEnum(PaymentType) paymentType!: PaymentType;
  @IsNumber() amountPaid!: number;
  @IsEnum(DiscountType) @IsOptional() discountType?: DiscountType;
  @IsNumber() @IsOptional() discountValue?: number;
  @IsString() @IsOptional() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SaleItemDto) items!: SaleItemDto[];
}

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async createSale(dto: CreateSaleDto, user: any) {
    if (dto.items.length === 0) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Sale must have items' });
    if ((dto.paymentType === 'CREDIT' || dto.paymentType === 'PARTIAL') && !dto.customerId) {
      throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Customer ID required for credit/partial' });
    }

    return this.prisma.$transaction(async tx => {
      // 1. Lock and validate products
      const pIds = dto.items.map(i => i.productId);
      const prds = await tx.product.findMany({ where: { id: { in: pIds } }, select: { id: true, stock: true, name: true, unit: true, costPrice: true }});
      const pMap = new Map(prds.map(p => [p.id, p]));

      let subtotal = 0;
      for (const item of dto.items) {
        const p = pMap.get(item.productId);
        if (!p) throw new NotFoundException({ error: 'PRODUCT_NOT_FOUND', message: \`Product \${item.productId} not found\` });
        if (Number(p.stock) < item.quantity) throw new BadRequestException({ error: 'INSUFFICIENT_STOCK', message: \`Not enough stock for \${p.name}\` });
        subtotal += item.quantity * item.unitPrice;
      }

      // 2. Compute totals
      let discountAmount = 0;
      if (dto.discountType === 'FLAT' && dto.discountValue) discountAmount = dto.discountValue;
      if (dto.discountType === 'PERCENTAGE' && dto.discountValue) discountAmount = subtotal * (dto.discountValue / 100);
      
      const grandTotal = subtotal - discountAmount;
      const actualPaid = dto.paymentType === 'CREDIT' ? 0 : dto.amountPaid;
      const balanceDue = dto.paymentType === 'CASH' ? 0 : grandTotal - actualPaid;

      // 3. Bill lock & gen
      const [lastSale] = await tx.$queryRaw<any[]>\`SELECT "billNumber" FROM "Sale" ORDER BY "billNumber" DESC LIMIT 1 FOR UPDATE\`;
      let nextNum = 1;
      if (lastSale && lastSale.billNumber) nextNum = parseInt(lastSale.billNumber.split('-')[1]) + 1;
      const billNumber = \`BILL-\${nextNum.toString().padStart(4, '0')}\`;

      // 4 & 5. Create Sale
      const sale = await tx.sale.create({
        data: {
          billNumber, customerId: dto.customerId, cashierId: user.id, paymentType: dto.paymentType,
          subtotal, discountType: dto.discountType || 'NONE', discountValue: dto.discountValue || 0,
          discountAmount, grandTotal, amountPaid: actualPaid, balanceDue, status: 'COMPLETED', notes: dto.notes,
          items: {
            create: dto.items.map(i => {
              const p = pMap.get(i.productId)!;
              return {
                productId: i.productId, productName: p.name, unit: p.unit, quantity: i.quantity,
                unitPrice: i.unitPrice, costPrice: p.costPrice, lineTotal: i.quantity * i.unitPrice
              };
            })
          }
        },
        include: { items: true, customer: true }
      });

      // 6. Deduct Stock & Movements
      for (const item of dto.items) {
        const p = pMap.get(item.productId)!;
        await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
        await tx.stockMovement.create({
          data: {
            productId: item.productId, movementType: 'STOCK_OUT', quantity: item.quantity,
            stockBefore: p.stock, stockAfter: Number(p.stock) - item.quantity,
            referenceId: sale.id, createdById: user.id, notes: \`Sale \${billNumber}\`
          }
        });
      }

      // 7. Ledger updates
      if (dto.customerId && balanceDue > 0) {
        const c = await tx.customer.findUnique({ where: { id: dto.customerId } });
        const newBal = Number(c!.currentBalance) + balanceDue;
        await tx.customer.update({ where: { id: dto.customerId }, data: { currentBalance: newBal } });
        await tx.ledgerEntry.create({
          data: {
            customerId: dto.customerId, saleId: sale.id, entryType: 'SALE_CREDIT',
            amount: balanceDue, balanceAfter: newBal, description: \`Bill \${billNumber} Credit\`
          }
        });
      }

      // 8. Payment Rec
      if (actualPaid > 0) {
        const pmt = await tx.payment.create({
          data: { customerId: dto.customerId || 'WALK_IN', saleId: sale.id, amount: actualPaid, collectedById: user.id }
        });
        
        // Update register
        const cr = await tx.cashRegister.findFirst({ where: { isClosedForDay: false }, orderBy: { date: 'desc' } });
        if (cr) await tx.cashRegister.update({ where: { id: cr.id }, data: { cashIn: { increment: actualPaid } } });
      }

      // 9. Activity
      await tx.activityLog.create({
        data: { userId: user.id, action: 'CREATE_SALE', entity: 'Sale', entityId: sale.id }
      });

      return sale;
    });
  }

  async getSales() {
    return this.prisma.sale.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { items: true, customer: true } });
  }
}

@ApiTags('sales')
@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly service: SalesService) {}
  
  @Roles('ADMIN', 'MANAGER', 'CASHIER')
  @Post()
  createSale(@Body() dto: CreateSaleDto, @CurrentUser() user: any) { return this.service.createSale(dto, user); }
  
  @Roles('ADMIN', 'MANAGER', 'CASHIER')
  @Get()
  getSales() { return this.service.getSales(); }
}

@Module({ providers: [SalesService], controllers: [SalesController] })
export class SalesModule {}
`);

console.log("Part 4 customers and sales generated.");
