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
        if (!p) throw new NotFoundException({ error: 'PRODUCT_NOT_FOUND', message: `Product ${item.productId} not found` });
        if (Number(p.stock) < item.quantity) throw new BadRequestException({ error: 'INSUFFICIENT_STOCK', message: `Not enough stock for ${p.name}` });
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
      const [lastSale] = await tx.$queryRaw<any[]>`SELECT "billNumber" FROM "Sale" ORDER BY "billNumber" DESC LIMIT 1 FOR UPDATE`;
      let nextNum = 1;
      if (lastSale && lastSale.billNumber) nextNum = parseInt(lastSale.billNumber.split('-')[1]) + 1;
      const billNumber = `BILL-${nextNum.toString().padStart(4, '0')}`;

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
