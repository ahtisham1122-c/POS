import { Module, Controller, Get, Post, Body, UseGuards, Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaymentType, DiscountType, SaleStatus } from '@prisma/client';
import { IsString, IsEnum, IsNumber, IsOptional, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { randomUUID } from 'crypto';

export class SaleItemDto {
  @IsString() productId!: string;
  @IsNumber() quantity!: number;
  @IsNumber() unitPrice!: number;
}

export class SplitPaymentDto {
  @IsString() method!: string;
  @IsNumber() amount!: number;
}

export class CreateSaleDto {
  @IsString() transactionId!: string;
  @IsString() @IsOptional() shiftId?: string;
  @IsString() @IsOptional() customerId?: string;
  @IsEnum(PaymentType) paymentType!: PaymentType;
  @IsNumber() amountPaid!: number;
  @IsNumber() @IsOptional() cashTendered?: number;
  @IsEnum(DiscountType) @IsOptional() discountType?: DiscountType;
  @IsNumber() @IsOptional() discountValue?: number;
  @IsString() @IsOptional() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SplitPaymentDto) @IsOptional() splitPayments?: SplitPaymentDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => SaleItemDto) items!: SaleItemDto[];
}

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async createSale(dto: CreateSaleDto, user: any) {
    if (dto.items.length === 0) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Sale must have items' });
    if (!dto.transactionId) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Transaction ID is required before saving a sale' });
    if ((dto.paymentType === 'CREDIT' || dto.paymentType === 'PARTIAL') && !dto.customerId) {
      throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Customer ID required for credit/partial' });
    }
    const existingSale = await this.prisma.sale.findUnique({ where: { transactionId: dto.transactionId } });
    if (existingSale) {
      throw new ConflictException({ error: 'DUPLICATE_SALE', message: 'This sale was already saved. The second save was blocked.' });
    }

    return this.prisma.$transaction(async tx => {
      const shift = dto.shiftId
        ? await tx.shift.findUnique({ where: { id: dto.shiftId } })
        : await tx.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
      if (!shift) {
        throw new BadRequestException({ error: 'NO_OPEN_SHIFT', message: 'Open a shift before completing a sale.' });
      }

      // 1. Lock and validate products
      const pIds = dto.items.map(i => i.productId);
      const prds = await tx.product.findMany({ where: { id: { in: pIds } }, select: { id: true, stock: true, name: true, unit: true, costPrice: true }});
      const pMap = new Map(prds.map(p => [p.id, p]));

      let subtotal = 0;
      for (const item of dto.items) {
        const p = pMap.get(item.productId);
        if (!p) throw new NotFoundException({ error: 'PRODUCT_NOT_FOUND', message: `Product ${item.productId} not found` });
        if (item.quantity <= 0) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Quantity must be greater than zero' });
        if (item.unitPrice < 0) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Price cannot be negative' });
        if (Number(p.stock) < item.quantity) throw new BadRequestException({ error: 'INSUFFICIENT_STOCK', message: `Not enough stock for ${p.name}` });
        subtotal += item.quantity * item.unitPrice;
      }

      // 2. Compute totals
      let discountAmount = 0;
      const discountValue = dto.discountValue || 0;
      if (discountValue < 0) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Discount cannot be negative' });
      if (dto.discountType === 'FLAT') discountAmount = discountValue;
      if (dto.discountType === 'PERCENTAGE') {
        if (discountValue > 100) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Percentage discount cannot be more than 100%' });
        discountAmount = subtotal * (discountValue / 100);
      }
      if (discountAmount > subtotal) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Discount cannot be more than the bill total' });
      
      const grandTotal = subtotal - discountAmount;
      const splitPayments = dto.splitPayments || [];
      const cashSplit = splitPayments.find(p => p.method.toUpperCase() === 'CASH');
      const onlineSplit = splitPayments.find(p => ['ONLINE', 'BANK', 'EASYPAISA', 'JAZZCASH'].includes(p.method.toUpperCase()));
      const cashAmount = cashSplit?.amount || (dto.paymentType === 'CASH' ? grandTotal : 0);
      const onlineAmount = onlineSplit?.amount || (dto.paymentType === 'ONLINE' ? grandTotal : 0);
      const actualPaid = dto.paymentType === 'CREDIT' ? 0 : (splitPayments.length ? splitPayments.reduce((sum, p) => sum + p.amount, 0) : dto.amountPaid);
      const cashTendered = dto.cashTendered ?? cashAmount;
      if (cashAmount < 0 || onlineAmount < 0 || actualPaid < 0) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Payment amounts cannot be negative' });
      if (cashTendered < cashAmount) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Cash tendered cannot be less than cash amount' });
      if (dto.paymentType !== 'CREDIT' && actualPaid < grandTotal) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Paid amount cannot be less than bill total' });
      if (actualPaid > grandTotal) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'Payment amount cannot be more than bill total. Use cash tendered for change.' });
      const changeReturned = Math.max(cashTendered - cashAmount, 0);
      const balanceDue = dto.paymentType === 'CREDIT' ? grandTotal : Math.max(grandTotal - actualPaid, 0);

      // 3. Bill lock & gen
      const [lastSale] = await tx.$queryRaw<any[]>`SELECT "billNumber" FROM "Sale" ORDER BY "billNumber" DESC LIMIT 1 FOR UPDATE`;
      let nextNum = 1;
      if (lastSale && lastSale.billNumber) nextNum = parseInt(lastSale.billNumber.split('-')[1]) + 1;
      const billNumber = `BILL-${nextNum.toString().padStart(4, '0')}`;

      // 4 & 5. Create Sale
      const sale = await tx.sale.create({
        data: {
          transactionId: dto.transactionId, shiftId: shift.id,
          billNumber, customerId: dto.customerId, cashierId: user.id, paymentType: dto.paymentType,
          subtotal, discountType: dto.discountType || 'NONE', discountValue: dto.discountValue || 0,
          discountAmount, grandTotal, amountPaid: actualPaid, cashTendered, changeReturned, balanceDue, status: 'COMPLETED', notes: dto.notes,
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
            referenceId: sale.id, createdById: user.id, notes: `Sale ${billNumber}`
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
            amount: balanceDue, balanceAfter: newBal, description: `Bill ${billNumber} Credit`
          }
        });
      }

      // 8. Payment breakdown and cash register
      const paymentBreakdown = splitPayments.length
        ? splitPayments
        : [
            ...(cashAmount > 0 ? [{ method: 'CASH', amount: cashAmount }] : []),
            ...(onlineAmount > 0 ? [{ method: 'ONLINE', amount: onlineAmount }] : []),
            ...(dto.paymentType === 'CREDIT' && grandTotal > 0 ? [{ method: 'CREDIT', amount: grandTotal }] : [])
          ];

      if (paymentBreakdown.length > 0) {
        await tx.splitPayment.createMany({
          data: paymentBreakdown.map(payment => ({
            id: randomUUID(),
            saleId: sale.id,
            method: payment.method.toUpperCase(),
            amount: payment.amount,
            customerId: dto.customerId,
            receivedById: user.id
          }))
        });
      }

      if (cashAmount > 0) {
        const cr = await tx.cashRegister.upsert({
          where: { shiftId: shift.id },
          update: {},
          create: { shiftId: shift.id, date: shift.shiftDate, openingBalance: shift.openingCash }
        });
        await tx.cashRegister.update({ where: { id: cr.id }, data: { cashIn: { increment: cashAmount } } });
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
