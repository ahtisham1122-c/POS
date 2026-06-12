import { Body, Controller, Get, Header, Injectable, Module, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaymentType, Prisma, Role, SaleStatus, StockMovementType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

function money(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function quantity(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(3)) : 0;
}

function pakistanDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function makePakistanDayRange(dateString?: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ''))
    ? String(dateString)
    : pakistanDateString();
  const start = new Date(`${date}T00:00:00.000+05:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { date, start, end };
}

function makePakistanRangeFromDate(date: Date) {
  const dateString = pakistanDateString(date);
  return makePakistanDayRange(dateString);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function minutesAgo(date: Date | null | undefined) {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 60000);
}

function normalizeMilkType(value?: string) {
  const milkType = String(value || 'MIXED').toUpperCase();
  return ['COW', 'BUFFALO', 'MIXED'].includes(milkType) ? milkType : 'MIXED';
}

function collectionRate(supplier: { defaultRate: Prisma.Decimal; cowRate: Prisma.Decimal; buffaloRate: Prisma.Decimal }, milkType: string) {
  const defaultRate = Number(supplier.defaultRate || 0);
  if (milkType === 'COW') return Number(supplier.cowRate || defaultRate || 0);
  if (milkType === 'BUFFALO') return Number(supplier.buffaloRate || defaultRate || 0);
  return defaultRate;
}

@Injectable()
export class OwnerDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSupplierEntryData() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        allowedShifts: true,
        milkSupplyMode: true,
        defaultRate: true,
        cowRate: true,
        buffaloRate: true,
        currentBalance: true,
      },
    });

    return {
      date: pakistanDateString(),
      suppliers: suppliers.map((supplier) => ({
        ...supplier,
        defaultRate: money(supplier.defaultRate),
        cowRate: money(supplier.cowRate),
        buffaloRate: money(supplier.buffaloRate),
        currentBalance: money(supplier.currentBalance),
      })),
    };
  }

  async createSupplierMilkEntry(dto: any, user: any) {
    const supplierId = String(dto?.supplierId || '').trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dto?.date || '')) ? String(dto.date) : pakistanDateString();
    const shift = String(dto?.shift || '').toUpperCase();
    const milkType = normalizeMilkType(dto?.milkType);
    const qty = Number(dto?.quantity || 0);
    const notes = String(dto?.notes || '').trim() || null;

    if (!supplierId) throw new Error('Supplier is required');
    if (!['MORNING', 'EVENING'].includes(shift)) throw new Error('Shift must be MORNING or EVENING');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Milk quantity must be greater than zero');

    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, isActive: true } });
      if (!supplier) throw new Error('Supplier not found or inactive');
      if (supplier.allowedShifts !== 'BOTH' && supplier.allowedShifts !== shift) {
        throw new Error(`${supplier.name} is not configured for ${shift.toLowerCase()} collection`);
      }
      const supplyMode = supplier.milkSupplyMode === 'SEPARATE' ? 'SEPARATE' : 'MIXED';
      if (supplyMode === 'MIXED' && milkType !== 'MIXED') {
        throw new Error(`${supplier.name} is configured for mixed milk. Use mixed entry only.`);
      }
      if (supplyMode === 'SEPARATE' && milkType === 'MIXED') {
        throw new Error(`${supplier.name} is configured for separate cow/buffalo milk.`);
      }

      const duplicate = await tx.milkCollection.findFirst({
        where: { supplierId, collectionDate: new Date(`${date}T00:00:00.000+05:00`), shift, milkType },
        select: { id: true },
      });
      if (duplicate) {
        throw new Error(`${supplier.name} ${milkType.toLowerCase()} milk is already entered for ${shift.toLowerCase()} on ${date}.`);
      }

      const rate = collectionRate(supplier, milkType);
      if (rate <= 0) throw new Error(`Set ${milkType.toLowerCase()} milk rate for ${supplier.name} first`);
      const totalAmount = money(qty * rate);
      const now = new Date();
      const userId = user?.id || 'system';
      const collection = await tx.milkCollection.create({
        data: {
          id: randomUUID(),
          supplierId,
          collectionDate: new Date(`${date}T00:00:00.000+05:00`),
          shift,
          milkType,
          quantity: qty,
          rate,
          totalAmount,
          notes,
          createdById: userId,
          createdAt: now,
        },
      });

      const newBalance = money(Number(supplier.currentBalance || 0) + totalAmount);
      await tx.supplier.update({
        where: { id: supplierId },
        data: { currentBalance: newBalance, updatedAt: now },
      });

      await tx.supplierLedgerEntry.create({
        data: {
          id: randomUUID(),
          supplierId,
          collectionId: collection.id,
          entryType: 'MILK_COLLECTION',
          amount: totalAmount,
          balanceAfter: newBalance,
          description: `${shift} ${milkType.toLowerCase()} milk collection ${qty} kg @ Rs. ${rate}`,
          entryDate: now,
          createdAt: now,
        },
      });

      const milkProduct = await tx.product.findFirst({ where: { code: 'MILK', isActive: true } });
      if (milkProduct) {
        const stockBefore = Number(milkProduct.stock || 0);
        const stockAfter = quantity(stockBefore + qty);
        await tx.product.update({
          where: { id: milkProduct.id },
          data: { stock: stockAfter, costPrice: rate, updatedAt: now },
        });
        await tx.stockMovement.create({
          data: {
            productId: milkProduct.id,
            movementType: StockMovementType.MILK_COLLECTION,
            quantity: qty,
            stockBefore,
            stockAfter,
            referenceId: collection.id,
            supplier: supplier.name,
            notes: `${shift} ${milkType.toLowerCase()} milk collection from ${supplier.name} - online owner entry`,
            createdById: userId,
            createdAt: now,
          },
        });
      }

      return {
        success: true,
        collectionId: collection.id,
        supplierName: supplier.name,
        quantity: qty,
        rate,
        totalAmount,
        supplierBalance: newBalance,
      };
    });
  }

  async getSummary(dateQuery?: string) {
    const { date, start, end } = makePakistanDayRange(dateQuery);
    const saleStatuses = [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED, SaleStatus.REFUNDED, SaleStatus.RETURNED];

    const [
      salesAgg,
      salesCount,
      cashSalesAgg,
      onlineSalesAgg,
      khataSalesAgg,
      splitPayments,
      realRefundAgg,
      correctionAgg,
      expenseAgg,
      milkAgg,
      supplierPaymentAgg,
      customerDuesAgg,
      customerDuesCount,
      supplierBalanceAgg,
      activeSupplierCount,
      products,
      latestRegister,
      openShift,
      devices,
      recentSales,
      topProducts,
      expenseByCategory,
      supplierSnapshots,
      selectedSaleItems,
      topCustomerSales,
    ] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { saleDate: { gte: start, lt: end }, status: { in: saleStatuses } },
        _sum: { grandTotal: true },
      }),
      this.prisma.sale.count({
        where: { saleDate: { gte: start, lt: end }, status: { in: saleStatuses } },
      }),
      this.prisma.sale.aggregate({
        where: { saleDate: { gte: start, lt: end }, status: { in: saleStatuses }, paymentType: PaymentType.CASH },
        _sum: { grandTotal: true },
      }),
      this.prisma.sale.aggregate({
        where: { saleDate: { gte: start, lt: end }, status: { in: saleStatuses }, paymentType: PaymentType.ONLINE },
        _sum: { grandTotal: true },
      }),
      this.prisma.sale.aggregate({
        where: { saleDate: { gte: start, lt: end }, status: { in: saleStatuses }, paymentType: PaymentType.CREDIT },
        _sum: { grandTotal: true },
      }),
      this.prisma.splitPayment.groupBy({
        by: ['method'],
        where: { createdAt: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      this.prisma.return.aggregate({
        where: {
          returnDate: { gte: start, lt: end },
          status: 'COMPLETED',
          correctionType: { not: 'CORRECTION' },
        },
        _sum: { refundAmount: true },
        _count: { id: true },
      }),
      this.prisma.return.aggregate({
        where: {
          returnDate: { gte: start, lt: end },
          status: 'COMPLETED',
          correctionType: 'CORRECTION',
        },
        _sum: { refundAmount: true },
        _count: { id: true },
      }),
      this.prisma.expense.aggregate({
        where: { expenseDate: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      this.prisma.milkCollection.aggregate({
        where: { collectionDate: { gte: start, lt: end } },
        _sum: { quantity: true, totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.supplierPayment.aggregate({
        where: { paymentDate: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      this.prisma.customer.aggregate({
        where: { currentBalance: { gt: 0 } },
        _sum: { currentBalance: true },
      }),
      this.prisma.customer.count({ where: { currentBalance: { gt: 0 } } }),
      this.prisma.supplier.aggregate({
        where: { currentBalance: { gt: 0 } },
        _sum: { currentBalance: true },
      }),
      this.prisma.supplier.count({ where: { isActive: true } }),
      this.prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true, stock: true, lowStockThreshold: true, costPrice: true, unit: true },
      }),
      this.prisma.cashRegister.findFirst({
        where: { date: { gte: start, lt: end } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.shift.findFirst({
        where: { status: 'OPEN' },
        orderBy: { openedAt: 'desc' },
      }),
      this.prisma.device.findMany({ orderBy: [{ terminalNumber: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.sale.findMany({
        where: { saleDate: { gte: start, lt: end }, status: { in: saleStatuses } },
        orderBy: { saleDate: 'desc' },
        take: 8,
        select: { billNumber: true, saleDate: true, paymentType: true, grandTotal: true, customer: { select: { name: true } } },
      }),
      this.prisma.saleItem.groupBy({
        by: ['productName', 'unit'],
        where: { sale: { saleDate: { gte: start, lt: end }, status: { in: saleStatuses } } },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 8,
      }),
      this.prisma.expense.groupBy({
        by: ['category'],
        where: { expenseDate: { gte: start, lt: end } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
      this.prisma.supplier.findMany({
        orderBy: [{ isActive: 'desc' }, { currentBalance: 'desc' }, { name: 'asc' }],
        select: {
          name: true,
          currentBalance: true,
          defaultRate: true,
          cowRate: true,
          buffaloRate: true,
          milkSupplyMode: true,
          isActive: true,
        },
      }),
      this.prisma.saleItem.findMany({
        where: { sale: { saleDate: { gte: start, lt: end }, status: { in: saleStatuses } } },
        select: {
          productName: true,
          unit: true,
          quantity: true,
          unitPrice: true,
          costPrice: true,
          lineTotal: true,
        },
      }),
      this.prisma.sale.groupBy({
        by: ['customerId'],
        where: { saleDate: { gte: start, lt: end }, status: { in: saleStatuses }, customerId: { not: null } },
        _sum: { grandTotal: true },
        _count: { id: true },
        orderBy: { _sum: { grandTotal: 'desc' } },
        take: 8,
      }),
    ]);

    const summarizeRange = async (rangeStart: Date, rangeEnd: Date) => {
      const [saleAgg, count, refundAgg, expenseForRange, milkForRange] = await Promise.all([
        this.prisma.sale.aggregate({
          where: { saleDate: { gte: rangeStart, lt: rangeEnd }, status: { in: saleStatuses } },
          _sum: { grandTotal: true },
        }),
        this.prisma.sale.count({
          where: { saleDate: { gte: rangeStart, lt: rangeEnd }, status: { in: saleStatuses } },
        }),
        this.prisma.return.aggregate({
          where: {
            returnDate: { gte: rangeStart, lt: rangeEnd },
            status: 'COMPLETED',
            correctionType: { not: 'CORRECTION' },
          },
          _sum: { refundAmount: true },
        }),
        this.prisma.expense.aggregate({
          where: { expenseDate: { gte: rangeStart, lt: rangeEnd } },
          _sum: { amount: true },
        }),
        this.prisma.milkCollection.aggregate({
          where: { collectionDate: { gte: rangeStart, lt: rangeEnd } },
          _sum: { quantity: true, totalAmount: true },
        }),
      ]);
      const gross = money(saleAgg._sum.grandTotal);
      const refundsForRange = money(refundAgg._sum.refundAmount);
      const expensesForRange = money(expenseForRange._sum.amount);
      const milkPurchaseForRange = money(milkForRange._sum.totalAmount);
      return {
        bills: count,
        grossSales: gross,
        refunds: refundsForRange,
        netSales: money(gross - refundsForRange),
        expenses: expensesForRange,
        milkKg: quantity(milkForRange._sum.quantity),
        milkPurchase: milkPurchaseForRange,
        operatingResult: money(gross - refundsForRange - expensesForRange - milkPurchaseForRange),
      };
    };

    const trendRanges = Array.from({ length: 30 }, (_, index) => {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() - (29 - index));
      return makePakistanRangeFromDate(day);
    });

    const salesTrend = await Promise.all(
      trendRanges.map(async (range) => {
        const [saleAgg, count, refundAgg, milkSold, yogurtSold, expenseForDay, milkPurchaseForDay, registerForDay, saleItemsForDay] = await Promise.all([
          this.prisma.sale.aggregate({
            where: { saleDate: { gte: range.start, lt: range.end }, status: { in: saleStatuses } },
            _sum: { grandTotal: true },
          }),
          this.prisma.sale.count({
            where: { saleDate: { gte: range.start, lt: range.end }, status: { in: saleStatuses } },
          }),
          this.prisma.return.aggregate({
            where: {
              returnDate: { gte: range.start, lt: range.end },
              status: 'COMPLETED',
              correctionType: { not: 'CORRECTION' },
            },
            _sum: { refundAmount: true },
          }),
          this.prisma.saleItem.aggregate({
            where: {
              product: { code: 'MILK' },
              sale: { saleDate: { gte: range.start, lt: range.end }, status: { in: saleStatuses } },
            },
            _sum: { quantity: true },
          }),
          this.prisma.saleItem.aggregate({
            where: {
              product: { code: 'YOGT' },
              sale: { saleDate: { gte: range.start, lt: range.end }, status: { in: saleStatuses } },
            },
            _sum: { quantity: true },
          }),
          this.prisma.expense.aggregate({
            where: { expenseDate: { gte: range.start, lt: range.end } },
            _sum: { amount: true },
          }),
          this.prisma.milkCollection.aggregate({
            where: { collectionDate: { gte: range.start, lt: range.end } },
            _sum: { quantity: true, totalAmount: true },
          }),
          this.prisma.cashRegister.findFirst({
            where: { date: { gte: range.start, lt: range.end } },
            orderBy: { createdAt: 'desc' },
          }),
          this.prisma.saleItem.findMany({
            where: { sale: { saleDate: { gte: range.start, lt: range.end }, status: { in: saleStatuses } } },
            select: { quantity: true, costPrice: true, lineTotal: true },
          }),
        ]);
        const gross = money(saleAgg._sum.grandTotal);
        const refundsForDay = money(refundAgg._sum.refundAmount);
        const expensesForDay = money(expenseForDay._sum.amount);
        const dayCogs = money(saleItemsForDay.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.costPrice || 0), 0));
        const dayGrossProfit = money(gross - refundsForDay - dayCogs);
        return {
          date: range.date,
          bills: count,
          grossSales: gross,
          refunds: refundsForDay,
          netSales: money(gross - refundsForDay),
          expenses: expensesForDay,
          cogs: dayCogs,
          grossProfit: dayGrossProfit,
          operatingProfit: money(dayGrossProfit - expensesForDay),
          milkKg: quantity(milkSold._sum.quantity),
          yogurtKg: quantity(yogurtSold._sum.quantity),
          milkPurchasedKg: quantity(milkPurchaseForDay._sum.quantity),
          milkPurchase: money(milkPurchaseForDay._sum.totalAmount),
          expectedCash: registerForDay
            ? money(Number(registerForDay.openingBalance) + Number(registerForDay.cashIn) - Number(registerForDay.cashOut))
            : 0,
          expectedOnline: money(registerForDay?.expectedOnline),
        };
      }),
    );

    const weeklyTrend = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const rangeEnd = addUtcDays(end, -7 * (7 - index));
        const rangeStart = addUtcDays(rangeEnd, -7);
        const summary = await summarizeRange(rangeStart, rangeEnd);
        return {
          label: `${pakistanDateString(rangeStart)} to ${pakistanDateString(addUtcDays(rangeEnd, -1))}`,
          ...summary,
        };
      }),
    );

    const monthlyTrend = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - (11 - index), 1));
        const monthDate = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}-01`;
        const monthRange = makePakistanDayRange(monthDate);
        const nextMonthStart = addUtcMonths(monthRange.start, 1);
        const summary = await summarizeRange(monthRange.start, nextMonthStart);
        return {
          label: monthDate.slice(0, 7),
          ...summary,
        };
      }),
    );

    const hourlySales = await Promise.all(
      Array.from({ length: 24 }, async (_, hour) => {
        const hourStart = new Date(start);
        hourStart.setUTCHours(start.getUTCHours() + hour, 0, 0, 0);
        const hourEnd = new Date(hourStart);
        hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);
        const [saleAgg, count] = await Promise.all([
          this.prisma.sale.aggregate({
            where: { saleDate: { gte: hourStart, lt: hourEnd }, status: { in: saleStatuses } },
            _sum: { grandTotal: true },
          }),
          this.prisma.sale.count({
            where: { saleDate: { gte: hourStart, lt: hourEnd }, status: { in: saleStatuses } },
          }),
        ]);
        return {
          hour,
          label: `${String(hour).padStart(2, '0')}:00`,
          sales: money(saleAgg._sum.grandTotal),
          bills: count,
        };
      }),
    );

    const customerIds = topCustomerSales.map((row) => row.customerId).filter(Boolean) as string[];
    const topCustomers = customerIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true, currentBalance: true },
        })
      : [];
    const customerNameById = new Map(topCustomers.map((customer) => [customer.id, customer]));
    const selectedRealReturns = await this.prisma.return.findMany({
      where: {
        returnDate: { gte: start, lt: end },
        status: 'COMPLETED',
        correctionType: { not: 'CORRECTION' },
      },
      select: { id: true },
    });
    const selectedReturnItems = selectedRealReturns.length
      ? await this.prisma.returnItem.findMany({
          where: { returnId: { in: selectedRealReturns.map((row) => row.id) } },
          select: { productId: true, productName: true, unit: true, quantity: true, lineTotal: true },
        })
      : [];

    const productContributionMap = new Map<string, { name: string; unit: string; quantity: number; revenue: number; grossProfit: number }>();
    const productCostByName = new Map(products.map((product) => [product.name, Number(product.costPrice || 0)]));
    const productCostById = new Map(products.map((product) => [product.id, Number(product.costPrice || 0)]));
    for (const item of selectedSaleItems) {
      const name = item.productName || 'Product';
      const existing = productContributionMap.get(name) || { name, unit: item.unit, quantity: 0, revenue: 0, grossProfit: 0 };
      const itemQuantity = Number(item.quantity || 0);
      const revenue = Number(item.lineTotal || 0);
      existing.quantity += itemQuantity;
      existing.revenue += revenue;
      existing.grossProfit += revenue - itemQuantity * Number(item.costPrice || 0);
      productContributionMap.set(name, existing);
    }
    for (const item of selectedReturnItems) {
      const name = item.productName || 'Product';
      const existing = productContributionMap.get(name) || { name, unit: item.unit, quantity: 0, revenue: 0, grossProfit: 0 };
      const itemQuantity = Number(item.quantity || 0);
      const returnedRevenue = Number(item.lineTotal || 0);
      const estimatedCost = Number(productCostById.get(item.productId) || productCostByName.get(item.productName) || 0);
      existing.quantity -= itemQuantity;
      existing.revenue -= returnedRevenue;
      existing.grossProfit -= returnedRevenue - itemQuantity * estimatedCost;
      productContributionMap.set(name, existing);
    }
    const productContribution = Array.from(productContributionMap.values())
      .map((item) => ({
        ...item,
        quantity: quantity(item.quantity),
        revenue: money(item.revenue),
        grossProfit: money(item.grossProfit),
        marginPercent: item.revenue > 0 ? money((item.grossProfit / item.revenue) * 100) : 0,
      }))
      .sort((a, b) => b.grossProfit - a.grossProfit)
      .slice(0, 8);
    const productRevenueRank = Array.from(productContributionMap.values())
      .map((item) => ({
        name: item.name,
        unit: item.unit,
        quantity: quantity(item.quantity),
        revenue: money(item.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    const splitByMethod = splitPayments.reduce<Record<string, number>>((acc, row) => {
      acc[String(row.method).toUpperCase()] = money(row._sum.amount);
      return acc;
    }, {});

    const grossSales = money(salesAgg._sum.grandTotal);
    const refunds = money(realRefundAgg._sum.refundAmount);
    const netSales = money(grossSales - refunds);
    const selectedSoldCost = selectedSaleItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.costPrice || 0), 0);
    const selectedReturnedEstimatedCost = selectedReturnItems.reduce((sum, item) => {
      const estimatedCost = Number(productCostById.get(item.productId) || productCostByName.get(item.productName) || 0);
      return sum + Number(item.quantity || 0) * estimatedCost;
    }, 0);
    const cogs = money(selectedSoldCost - selectedReturnedEstimatedCost);
    const grossProfit = money(
      netSales - cogs,
    );
    const estimatedOperatingProfit = money(grossProfit - money(expenseAgg._sum.amount));
    const expenseRatio = netSales > 0 ? money((money(expenseAgg._sum.amount) / netSales) * 100) : 0;
    const grossMarginPercent = netSales > 0 ? money((grossProfit / netSales) * 100) : 0;
    const selectedDayTrend = salesTrend[salesTrend.length - 1] || null;
    const previousDayTrend = salesTrend[salesTrend.length - 2] || null;
    const selectedDayNet = Number(selectedDayTrend?.netSales || 0);
    const previousDayNet = Number(previousDayTrend?.netSales || 0);
    const dayChangePercent = previousDayNet > 0 ? money(((selectedDayNet - previousDayNet) / previousDayNet) * 100) : 0;
    const currentWeek = weeklyTrend[weeklyTrend.length - 1] || null;
    const previousWeek = weeklyTrend[weeklyTrend.length - 2] || null;
    const weekChangePercent = Number(previousWeek?.netSales || 0) > 0
      ? money(((Number(currentWeek?.netSales || 0) - Number(previousWeek?.netSales || 0)) / Number(previousWeek?.netSales || 1)) * 100)
      : 0;
    const currentMonth = monthlyTrend[monthlyTrend.length - 1] || null;
    const previousMonth = monthlyTrend[monthlyTrend.length - 2] || null;
    const monthChangePercent = Number(previousMonth?.netSales || 0) > 0
      ? money(((Number(currentMonth?.netSales || 0) - Number(previousMonth?.netSales || 0)) / Number(previousMonth?.netSales || 1)) * 100)
      : 0;
    const busiestHour = hourlySales.reduce((best, row) => Number(row.sales) > Number(best.sales) ? row : best, hourlySales[0] || { label: '00:00', sales: 0, bills: 0 });
    const topProductByRevenue = topProducts[0];
    const milkProduct = products.find((p) => p.code === 'MILK');
    const yogurtProduct = products.find((p) => p.code === 'YOGT');
    const lowStockCount = products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.lowStockThreshold)).length;
    const outOfStockCount = products.filter((p) => Number(p.stock) <= 0).length;
    const stockValue = products.reduce((sum, p) => sum + Number(p.stock) * Number(p.costPrice), 0);
    const lowStockProducts = products
      .filter((p) => Number(p.stock) <= 0 || Number(p.stock) <= Number(p.lowStockThreshold))
      .sort((a, b) => Number(a.stock) - Number(b.stock))
      .slice(0, 8);
    const deviceHealth = devices.map((device) => {
      const seenMinutesAgo = minutesAgo(device.lastSeenAt);
      return {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        terminalNumber: device.terminalNumber,
        lastSeenAt: device.lastSeenAt?.toISOString() || null,
        lastSyncedAt: device.lastSyncedAt?.toISOString() || null,
        revoked: Boolean(device.revokedAt),
        health: device.revokedAt
          ? 'revoked'
          : seenMinutesAgo === null
            ? 'never_seen'
            : seenMinutesAgo <= 15
              ? 'online'
              : seenMinutesAgo <= 120
                ? 'stale'
                : 'offline',
        minutesSinceSeen: seenMinutesAgo,
      };
    });
    const insights = [
      {
        tone: dayChangePercent >= 0 ? 'good' : 'warn',
        title: 'Day trend',
        value: `${dayChangePercent >= 0 ? '+' : ''}${dayChangePercent}%`,
        detail: previousDayNet > 0
          ? `Net sales compared with ${previousDayTrend?.date || 'previous day'}.`
          : 'No previous-day cloud sales to compare yet.',
      },
      {
        tone: weekChangePercent >= 0 ? 'good' : 'warn',
        title: 'Weekly momentum',
        value: `${weekChangePercent >= 0 ? '+' : ''}${weekChangePercent}%`,
        detail: 'Current 7-day period compared with previous 7-day period.',
      },
      {
        tone: expenseRatio <= 18 ? 'good' : expenseRatio <= 30 ? 'warn' : 'danger',
        title: 'Expense pressure',
        value: `${expenseRatio}%`,
        detail: 'Selected-day expenses as a percentage of net sales.',
      },
      {
        tone: deviceHealth.some((device) => device.health === 'online') ? 'good' : 'danger',
        title: 'POS cloud status',
        value: deviceHealth.some((device) => device.health === 'online') ? 'Online' : 'Needs check',
        detail: 'At least one POS should contact the cloud during shop hours.',
      },
      {
        tone: lowStockCount + outOfStockCount === 0 ? 'good' : 'warn',
        title: 'Stock control',
        value: `${lowStockCount + outOfStockCount} alerts`,
        detail: 'Low or empty stock items based on current cloud inventory.',
      },
      {
        tone: 'info',
        title: 'Peak hour',
        value: busiestHour?.label || 'N/A',
        detail: `${money(busiestHour?.sales)} sales from ${Number(busiestHour?.bills || 0)} bills.`,
      },
    ];

    return {
      date,
      generatedAt: new Date().toISOString(),
      sales: {
        billCount: salesCount,
        grossSales,
        refunds,
        correctionReturns: {
          count: Number(correctionAgg._count.id || 0),
          amount: money(correctionAgg._sum.refundAmount),
        },
        netSales,
        cashSales: money(cashSalesAgg._sum.grandTotal) + money(splitByMethod.CASH),
        onlineSales: money(onlineSalesAgg._sum.grandTotal) + money(splitByMethod.ONLINE),
        khataSales: money(khataSalesAgg._sum.grandTotal) + money(splitByMethod.CREDIT) + money(splitByMethod.KHATA),
        avgBill: salesCount > 0 ? money(netSales / salesCount) : 0,
      },
      register: latestRegister
        ? {
            isClosed: latestRegister.isClosedForDay,
            openingCash: money(latestRegister.openingBalance),
            cashIn: money(latestRegister.cashIn),
            cashOut: money(latestRegister.cashOut),
            expectedCash: money(Number(latestRegister.openingBalance) + Number(latestRegister.cashIn) - Number(latestRegister.cashOut)),
            closingCash: money(latestRegister.closingBalance),
            expectedOnline: money(latestRegister.expectedOnline),
            closingOnline: money(latestRegister.closingOnline),
            onlineVariance: money(latestRegister.onlineVariance),
          }
        : null,
      shift: openShift
        ? {
            id: openShift.id,
            date: openShift.shiftDate.toISOString().slice(0, 10),
            openedAt: openShift.openedAt.toISOString(),
            minutesOpen: Math.max(0, minutesAgo(openShift.openedAt) || 0),
          }
        : null,
      khata: {
        customersOwing: customerDuesCount,
        totalDue: money(customerDuesAgg._sum.currentBalance),
      },
      suppliers: {
        activeSuppliers: activeSupplierCount,
        milkKgToday: quantity(milkAgg._sum.quantity),
        milkPurchaseToday: money(milkAgg._sum.totalAmount),
        milkCollectionEntries: Number(milkAgg._count.id || 0),
        supplierPaymentsToday: money(supplierPaymentAgg._sum.amount),
        payableToSuppliers: money(supplierBalanceAgg._sum.currentBalance),
      },
      expenses: {
        today: money(expenseAgg._sum.amount),
      },
      inventory: {
        stockValue: money(stockValue),
        lowStockCount,
        outOfStockCount,
        milkKg: quantity(milkProduct?.stock),
        yogurtKg: quantity(yogurtProduct?.stock),
        alerts: lowStockProducts.map((product) => ({
          code: product.code,
          name: product.name,
          stock: quantity(product.stock),
          threshold: quantity(product.lowStockThreshold),
          unit: product.unit,
        })),
      },
      devices: deviceHealth,
      recentSales: recentSales.map((sale) => ({
        billNumber: sale.billNumber,
        saleDate: sale.saleDate.toISOString(),
        paymentType: sale.paymentType,
        grandTotal: money(sale.grandTotal),
        customerName: sale.customer?.name || 'Walk-in',
      })),
      charts: {
        salesTrend,
        weeklyTrend,
        monthlyTrend,
        hourlySales,
        paymentMix: [
          { name: 'Cash', value: money(cashSalesAgg._sum.grandTotal) + money(splitByMethod.CASH) },
          { name: 'Online', value: money(onlineSalesAgg._sum.grandTotal) + money(splitByMethod.ONLINE) },
          { name: 'Khata', value: money(khataSalesAgg._sum.grandTotal) + money(splitByMethod.CREDIT) + money(splitByMethod.KHATA) },
        ],
        topProducts: productRevenueRank,
        expenseByCategory: expenseByCategory.map((item) => ({
          category: item.category,
          amount: money(item._sum.amount),
        })),
        supplierBalances: supplierSnapshots.map((supplier) => ({
          name: supplier.name,
          balance: money(supplier.currentBalance),
          mode: supplier.milkSupplyMode,
          defaultRate: money(supplier.defaultRate),
          cowRate: money(supplier.cowRate),
          buffaloRate: money(supplier.buffaloRate),
          isActive: supplier.isActive,
        })),
        productContribution,
        topCustomers: topCustomerSales.map((row) => {
          const customer = row.customerId ? customerNameById.get(row.customerId) : null;
          return {
            name: customer?.name || 'Customer',
            sales: money(row._sum.grandTotal),
            bills: Number(row._count.id || 0),
            currentBalance: money(customer?.currentBalance),
          };
        }),
      },
      analytics: {
        cogs,
        grossProfit,
        grossMarginPercent,
        estimatedOperatingProfit,
        expenseRatio,
        dayChangePercent,
        weekChangePercent,
        monthChangePercent,
        busiestHour,
        topProduct: topProductByRevenue
          ? {
              name: topProductByRevenue.productName,
              unit: topProductByRevenue.unit,
              quantity: quantity(topProductByRevenue._sum.quantity),
              revenue: money(topProductByRevenue._sum.lineTotal),
            }
          : null,
        selectedPeriod: {
          day: selectedDayTrend,
          week: currentWeek,
          month: currentMonth,
        },
        dataQuality: {
          source: 'Cloud synced POS database',
          saleRows: salesCount,
          returnRows: Number(realRefundAgg._count.id || 0),
          returnedItemRows: selectedReturnItems.length,
          usesOriginalSaleItemCost: true,
          returnedItemCostIsEstimated: selectedReturnItems.length > 0,
          lastDeviceSeenMinutes: deviceHealth.length
            ? Math.min(...deviceHealth.map((device) => device.minutesSinceSeen ?? 999999))
            : null,
        },
        insights,
      },
    };
  }
}

function ownerDashboardHtml() {
  return ownerDashboardWebsiteHtml();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#060b0d" />
  <title>Noon Dairy Control Room</title>
  <style>
    :root{color-scheme:dark;--bg:#060b0d;--s1:#0d1518;--s2:#111d21;--s3:#17272c;--line:#263a40;--text:#f5fbfc;--muted:#8ca3aa;--soft:#c9d8dc;--brand:#19c7b5;--blue:#4f9df7;--good:#2bd576;--warn:#f2b84b;--bad:#ef5a68;--shadow:0 18px 45px rgba(0,0,0,.34)}
    *{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;min-height:100vh;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;background:radial-gradient(circle at 18% -10%,rgba(25,199,181,.22),transparent 34%),radial-gradient(circle at 92% 2%,rgba(79,157,247,.16),transparent 30%),linear-gradient(160deg,#060b0d 0%,#0b1215 48%,#0d1117 100%);color:var(--text)}
    header{position:sticky;top:0;z-index:20;padding:14px 18px 12px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(6,11,13,.9);backdrop-filter:blur(18px)}main,.wrap{max-width:1240px;margin:0 auto}main{padding:16px 16px 36px}.top{display:flex;align-items:center;justify-content:space-between;gap:14px}.brand{display:flex;align-items:center;gap:12px;min-width:0}.logo{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;color:#031315;font-weight:1000;background:linear-gradient(135deg,var(--brand),var(--blue));box-shadow:0 12px 30px rgba(25,199,181,.2)}h1{margin:0;font-size:20px;letter-spacing:.2px}.sub{margin-top:3px;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.actions{display:flex;gap:8px;width:100%;max-width:370px}
    nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.navbtn{background:rgba(17,29,33,.92);color:var(--soft);border:1px solid var(--line);box-shadow:none}.navbtn.active{background:linear-gradient(135deg,var(--brand),var(--blue));color:#031315;border-color:transparent}
    button,input,select{width:100%;min-height:46px;border-radius:12px;border:1px solid var(--line);background:#081114;color:var(--text);padding:0 13px;font-weight:850;font-size:14px}button{background:linear-gradient(135deg,var(--brand),var(--blue));color:#031315;border:0;cursor:pointer;font-weight:1000;box-shadow:0 10px 24px rgba(25,199,181,.13)}button.secondary{background:#142328;color:var(--text);border:1px solid var(--line);box-shadow:none}button.danger{background:#3b1d24;color:#fecdd3;border:1px solid #74313b;box-shadow:none}button:disabled{opacity:.55;cursor:not-allowed}
    .login,.panel,.metric{background:linear-gradient(180deg,rgba(17,29,33,.97),rgba(11,19,22,.97));border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:15px;box-shadow:var(--shadow)}.layout{display:grid;gap:14px}.toolbar{display:grid;grid-template-columns:1fr 112px 112px 120px;gap:9px;align-items:center}.hero{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(300px,.75fr);gap:14px}.hero-main{min-height:218px;padding:22px;border-radius:22px;overflow:hidden;position:relative;background:linear-gradient(135deg,rgba(25,199,181,.26),rgba(79,157,247,.15)),#0f1b1f;border:1px solid rgba(255,255,255,.11);box-shadow:var(--shadow)}.hero-main:before{content:"";position:absolute;right:-90px;bottom:-130px;width:310px;height:310px;border-radius:50%;border:58px solid rgba(255,255,255,.055)}.hero-content{position:relative;z-index:1}.hero-title,.label{color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:1000;letter-spacing:.8px}.hero-value{font-size:48px;line-height:1;font-weight:1000;margin:12px 0 10px;letter-spacing:-1px}.hero-row{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.wide{grid-column:span 2}.full{grid-column:1/-1}.value{display:block;font-size:25px;font-weight:1000;margin-top:8px;letter-spacing:-.2px}.hint,.section-title p{color:var(--muted);font-size:12px;line-height:1.35}.section-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}.section-title p{margin:4px 0 0}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:13px}.row:last-child{border-bottom:0}.row strong{text-align:right}.pill{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 10px;border-radius:999px;background:#0b1417;border:1px solid var(--line);font-size:11px;font-weight:1000;color:var(--soft);white-space:nowrap}.online{color:var(--good)}.stale{color:var(--warn)}.offline,.revoked,.never_seen{color:var(--bad)}
    .chart-box{width:100%;min-height:220px;border-radius:14px;background:#081114;border:1px solid rgba(255,255,255,.06);overflow:hidden}svg{display:block;width:100%;height:100%}.mix{display:grid;gap:9px;margin-top:10px}.mix-row{display:grid;grid-template-columns:76px 1fr 88px;gap:9px;align-items:center;font-size:12px}.track{height:11px;border-radius:999px;background:#0b1417;overflow:hidden;border:1px solid var(--line)}.fill{height:100%;width:0%;border-radius:999px}.cash{background:var(--brand)}.online-bg{background:var(--blue)}.khata-bg{background:var(--warn)}.table-head,.table-row{display:grid;grid-template-columns:1.4fr .8fr .8fr;gap:8px}.table-head{color:var(--muted);font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.65px;padding:0 0 8px;border-bottom:1px solid rgba(255,255,255,.08)}.table-row{align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px}.right{text-align:right}.hidden{display:none!important}.error{color:#fecaca;background:#451a1a;border:1px solid #7f1d1d;border-radius:10px;padding:10px;margin-top:10px}.success{color:#bbf7d0;background:#13341f;border:1px solid #166534;border-radius:10px;padding:10px;margin-top:10px}.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:50;max-width:92vw;padding:12px 14px;border-radius:12px;background:#0f1b1f;border:1px solid var(--line);box-shadow:var(--shadow);font-size:13px}
    @media(max-width:980px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.three{grid-template-columns:1fr}.wide{grid-column:span 2}.toolbar{grid-template-columns:1fr 1fr 1fr}.toolbar button:last-child{grid-column:auto}}@media(max-width:620px){header{padding:12px 10px 10px}.top{align-items:flex-start;flex-direction:column}.brand{width:100%}.actions{max-width:none}main{padding:10px}.grid,.two{grid-template-columns:1fr}.wide{grid-column:span 1}nav{grid-template-columns:repeat(2,minmax(0,1fr))}.hero-main{padding:17px;min-height:190px}.hero-value{font-size:37px}.toolbar{grid-template-columns:1fr 1fr}.toolbar input{grid-column:1/-1}.mix-row{grid-template-columns:64px 1fr 76px}.table-head,.table-row{grid-template-columns:1.2fr .7fr .8fr}}
  </style>
</head>
<body>
  <header><div class="wrap"><div class="top"><div class="brand"><div class="logo">ND</div><div><h1>Noon Dairy Control Room</h1><div class="sub" id="stamp">Private VPS owner dashboard</div></div></div><div class="actions"><button class="secondary" id="refreshBtn" onclick="loadSummary()">Refresh</button><button class="danger" onclick="logout()">Logout</button></div></div><nav id="nav" class="hidden"><button id="tabDashboard" class="navbtn" onclick="showTab('dashboard')">Dashboard</button><button id="tabMoney" class="navbtn" onclick="showTab('money')">Money</button><button id="tabOperations" class="navbtn" onclick="showTab('operations')">Operations</button><button id="tabSupplierEntry" class="navbtn" onclick="showTab('supplierEntry')">Supplier Entry</button></nav></div></header>
  <main>
    <section id="login" class="login"><div class="section-title"><div><div class="label">Owner Login</div><p>Secure mobile dashboard for sales, cash, stock, suppliers, and online milk entry.</p></div></div><div class="three"><input id="username" placeholder="Username" autocomplete="username" /><input id="password" placeholder="Password/PIN" type="password" autocomplete="current-password" /><button onclick="login()">Login</button></div><div id="loginError"></div></section>
    <section id="dashboard" class="hidden layout"><div class="toolbar"><input id="summaryDate" type="date" onchange="loadSummary()" /><button class="secondary" onclick="moveDate(-1)">Previous</button><button class="secondary" onclick="moveDate(1)">Next</button><button class="secondary" onclick="today()">Today</button></div><div class="hero"><div class="hero-main"><div class="hero-content"><div class="hero-title">Net Sales</div><div class="hero-value" id="heroNet">Rs. 0</div><div class="hint">After real refunds. Correction returns are tracked separately.</div><div class="hero-row"><span class="pill" id="heroBills">0 bills</span><span class="pill" id="heroAvg">Avg Rs. 0</span><span class="pill" id="heroShift">Shift status</span><span class="pill" id="heroSync">Cloud live</span></div></div></div><div class="panel"><div class="section-title"><div><div class="label">Cash Register</div><p id="heroCashHint">Expected cash in drawer</p></div><span class="pill" id="registerState">Open</span></div><span class="value" id="heroCash">Rs. 0</span><div class="mix" id="registerLines"></div></div></div><div class="grid" id="cards"></div><div class="grid"><div class="panel wide"><div class="section-title"><div><div class="label">7 Day Sales Trend</div><p>Net sales by date from cloud synced records.</p></div><span class="pill">Net sales</span></div><div class="chart-box" id="salesTrend"></div></div><div class="panel wide"><div class="section-title"><div><div class="label">Payment Mix</div><p>Cash, online, and khata split.</p></div><span class="pill">Today</span></div><div id="paymentMix"></div></div></div></section>
    <section id="money" class="hidden layout"><div class="toolbar"><input id="moneyDate" type="date" onchange="syncDateFrom('moneyDate')" /><button class="secondary" onclick="moveDate(-1)">Previous</button><button class="secondary" onclick="moveDate(1)">Next</button><button class="secondary" onclick="today()">Today</button></div><div class="grid"><div class="panel wide"><div class="section-title"><div><div class="label">Top Products</div><p>Highest revenue items for selected date.</p></div></div><div id="topProducts"></div></div><div class="panel wide"><div class="section-title"><div><div class="label">Expense Categories</div><p>Daily expense pressure by category.</p></div></div><div id="expenseCategories"></div></div><div class="panel wide"><div class="section-title"><div><div class="label">Recent Sales</div><p>Latest cloud sales synced from POS.</p></div></div><div id="recentSales"></div></div><div class="panel wide"><div class="section-title"><div><div class="label">Khata / Supplier Money</div><p>Customer receivable and farmer payable.</p></div></div><div id="moneyRows"></div></div></div></section>
    <section id="operations" class="hidden"><div class="grid"><div class="panel wide"><div class="section-title"><div><div class="label">Device Health</div><p>Last cloud contact from each registered terminal.</p></div></div><div id="devices"></div></div><div class="panel wide"><div class="section-title"><div><div class="label">Inventory Alerts</div><p>Items at or below low stock threshold.</p></div></div><div id="inventoryAlerts"></div></div><div class="panel wide"><div class="section-title"><div><div class="label">Supplier Balances</div><p>Farmer balances and configured milk rates.</p></div></div><div id="supplierBalances"></div></div><div class="panel wide"><div class="section-title"><div><div class="label">Milk / Yogurt Volume</div><p>Seven-day sold volume view.</p></div></div><div id="volumeTrend"></div></div></div></section>
    <section id="supplierEntry" class="hidden"><div class="panel"><div class="section-title"><div><div class="label">Online Supplier Milk Entry</div><p>This writes directly to VPS cloud. POS supplier tab pulls it before supplier work.</p></div><button class="secondary" style="max-width:150px" onclick="loadSupplierEntryData()">Refresh</button></div><div class="grid"><select id="supplierId" onchange="supplierChanged()"></select><input id="entryDate" type="date" /><select id="entryShift"><option value="MORNING">Morning</option><option value="EVENING">Evening</option></select><select id="entryMilkType"><option value="MIXED">Mixed</option><option value="COW">Cow</option><option value="BUFFALO">Buffalo</option></select><input id="entryQuantity" type="number" step="0.25" min="0.25" placeholder="Milk kg" /><input id="entryNotes" placeholder="Notes optional" /><button onclick="saveSupplierEntry()">Save Milk Entry</button></div><div class="hint" id="supplierHint" style="margin-top:10px"></div><div id="entryMessage"></div></div></section>
  </main><div id="toast" class="toast hidden"></div>
  <script>
    let token=localStorage.getItem('ownerAccessToken')||'';let supplierRows=[];let refreshTimer=null;
    const money=(n)=>'Rs. '+Math.round(Number(n||0)).toLocaleString('en-PK');const qty=(n)=>Number(n||0).toLocaleString('en-PK',{maximumFractionDigits:2});const todayIso=()=>new Date().toISOString().slice(0,10);
    function safe(t){return String(t??'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
    function toastMessage(t){toast.textContent=t;toast.classList.remove('hidden');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(function(){toast.classList.add('hidden')},2600)}
    function setLoading(v){refreshBtn.disabled=v;refreshBtn.textContent=v?'Loading...':'Refresh'}
    function boot(){if(!token)return;login.classList.add('hidden');nav.classList.remove('hidden');showTab('dashboard');loadSummary();loadSupplierEntryData();refreshTimer=setInterval(loadSummary,60000)}
    function showTab(id){['dashboard','money','operations','supplierEntry'].forEach(function(s){document.getElementById(s).classList.add('hidden')});['tabDashboard','tabMoney','tabOperations','tabSupplierEntry'].forEach(function(t){document.getElementById(t).classList.remove('active')});const m={dashboard:'tabDashboard',money:'tabMoney',operations:'tabOperations',supplierEntry:'tabSupplierEntry'};document.getElementById(m[id]).classList.add('active');document.getElementById(id).classList.remove('hidden');if(id==='supplierEntry')loadSupplierEntryData()}
    function logout(){localStorage.removeItem('ownerAccessToken');clearInterval(refreshTimer);location.reload()}
    async function login(){loginError.innerHTML='';try{const r=await fetch('auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.value,password:password.value})});if(!r.ok){loginError.innerHTML='<div class="error">Login failed. Use backend admin/manager login.</div>';return}const d=await r.json();token=d.accessToken;localStorage.setItem('ownerAccessToken',token);boot()}catch(e){loginError.innerHTML='<div class="error">Network error. Check VPS internet and try again.</div>'}}
    function selectedDate(){return summaryDate.value||moneyDate.value||''}function syncDateControls(d){summaryDate.value=d||'';moneyDate.value=d||''}function syncDateFrom(id){syncDateControls(document.getElementById(id).value);loadSummary()}function moveDate(days){const b=selectedDate()?new Date(selectedDate()+'T00:00:00'):new Date();b.setDate(b.getDate()+days);syncDateControls(b.toISOString().slice(0,10));loadSummary()}function today(){syncDateControls(todayIso());loadSummary()}
    async function loadSummary(){if(!token)return;setLoading(true);let d;try{const q=selectedDate()?'?date='+encodeURIComponent(selectedDate()):'';const r=await fetch('owner-dashboard/summary'+q,{headers:{Authorization:'Bearer '+token}});if(r.status===401||r.status===403){localStorage.removeItem('ownerAccessToken');location.reload();return}if(!r.ok)throw new Error('fetch failed');d=await r.json()}catch(e){toastMessage('Dashboard could not refresh. Check VPS connection.');setLoading(false);return}syncDateControls(d.date);stamp.textContent='Date '+d.date+' | Updated '+new Date(d.generatedAt).toLocaleString('en-PK',{dateStyle:'medium',timeStyle:'short'});heroNet.textContent=money(d.sales.netSales);heroBills.textContent=d.sales.billCount+' bills';heroAvg.textContent='Avg '+money(d.sales.avgBill);heroShift.textContent=d.shift?'Open '+Math.floor(d.shift.minutesOpen/60)+'h '+(d.shift.minutesOpen%60)+'m':'No open shift';heroSync.textContent=d.devices&&d.devices.some(function(x){return x.health==='online'})?'Cloud live':'No live POS';heroCash.textContent=money(d.register?.expectedCash);heroCashHint.textContent=d.register?.isClosed?'Register closed':'Expected cash in drawer';registerState.textContent=d.register?.isClosed?'Closed':'Open';registerState.className='pill '+(d.register?.isClosed?'stale':'online');registerLines.innerHTML=[['Opening',money(d.register?.openingCash)],['Cash In',money(d.register?.cashIn)],['Cash Out',money(d.register?.cashOut)],['Online Expected',money(d.register?.expectedOnline)]].map(function(r){return '<div class="row"><span>'+r[0]+'</span><strong>'+r[1]+'</strong></div>'}).join('');
      cards.innerHTML=[['Gross Sales',money(d.sales.grossSales),d.sales.billCount+' bills'],['Refunds',money(d.sales.refunds),'real refunds only'],['Online Sales',money(d.sales.onlineSales),'expected '+money(d.register?.expectedOnline)],['Khata Sales',money(d.sales.khataSales),d.khata.customersOwing+' owing customers'],['Milk Bought',qty(d.suppliers.milkKgToday)+' kg',money(d.suppliers.milkPurchaseToday)],['Supplier Payable',money(d.suppliers.payableToSuppliers),d.suppliers.activeSuppliers+' active suppliers'],['Expenses',money(d.expenses.today),'selected date'],['Stock Value',money(d.inventory.stockValue),'Milk '+qty(d.inventory.milkKg)+' kg, yogurt '+qty(d.inventory.yogurtKg)+' kg']].map(function(r){return '<div class="metric"><div class="label">'+r[0]+'</div><span class="value">'+r[1]+'</span><div class="hint">'+r[2]+'</div></div>'}).join('');
      renderTrend(d.charts.salesTrend||[]);renderPaymentMix(d.charts.paymentMix||[]);renderRows('devices',d.devices||[],function(x){return '<div class="row"><span>'+safe(x.deviceName)+'</span><span class="pill '+x.health+'">'+safe(x.health)+' '+(x.minutesSinceSeen??'-')+'m</span></div>'},'No devices');renderRows('recentSales',d.recentSales||[],function(x){return '<div class="row"><span><strong>'+safe(x.billNumber)+'</strong><br><span class="hint">'+safe(x.paymentType)+' / '+safe(x.customerName)+'</span></span><strong>'+money(x.grandTotal)+'</strong></div>'},'No sales for this date');renderRows('topProducts',d.charts.topProducts||[],function(x){return '<div class="row"><span>'+safe(x.name)+'<br><span class="hint">'+qty(x.quantity)+' '+safe(x.unit)+'</span></span><strong>'+money(x.revenue)+'</strong></div>'},'No product sales');renderRows('expenseCategories',d.charts.expenseByCategory||[],function(x){return '<div class="row"><span>'+safe(x.category).replaceAll('_',' ')+'</span><strong>'+money(x.amount)+'</strong></div>'},'No expenses');renderRows('inventoryAlerts',d.inventory.alerts||[],function(x){const tone=Number(x.stock)<=0?'offline':'stale';return '<div class="row"><span>'+safe(x.name)+'<br><span class="hint">threshold '+qty(x.threshold)+' '+safe(x.unit)+'</span></span><span class="pill '+tone+'">'+qty(x.stock)+' '+safe(x.unit)+'</span></div>'},'No low stock alerts');renderRows('supplierBalances',d.charts.supplierBalances||[],function(x){const rt=x.mode==='SEPARATE'?'Cow '+money(x.cowRate)+' / Buffalo '+money(x.buffaloRate):'Mixed '+money(x.defaultRate);return '<div class="row"><span>'+safe(x.name)+'<br><span class="hint">'+safe(rt)+'</span></span><strong>'+money(x.balance)+'</strong></div>'},'No active suppliers');moneyRows.innerHTML=[['Customer Khata Due',money(d.khata.totalDue),d.khata.customersOwing+' customers'],['Supplier Payable',money(d.suppliers.payableToSuppliers),d.suppliers.activeSuppliers+' suppliers'],['Supplier Paid Today',money(d.suppliers.supplierPaymentsToday),'cash out'],['Correction Returns',money(d.sales.correctionReturns.amount),d.sales.correctionReturns.count+' entries']].map(function(r){return '<div class="row"><span>'+r[0]+'<br><span class="hint">'+r[2]+'</span></span><strong>'+r[1]+'</strong></div>'}).join('');renderVolumeTrend(d.charts.salesTrend||[]);setLoading(false)}
    function renderRows(id,rows,render,empty){document.getElementById(id).innerHTML=rows.length?rows.map(render).join(''):'<div class="hint">'+empty+'</div>'}
    function renderTrend(rows){if(!rows.length){salesTrend.innerHTML='<div class="hint" style="padding:16px">No sales trend yet.</div>';return}const w=720,h=220,p=28,max=Math.max(1,...rows.map(function(x){return Number(x.netSales||0)}));const pts=rows.map(function(x,i){return{x:p+(i*(w-p*2)/Math.max(1,rows.length-1)),y:h-p-(Number(x.netSales||0)/max)*(h-p*2),row:x}});const line=pts.map(function(v){return v.x.toFixed(1)+','+v.y.toFixed(1)}).join(' ');const area=p+','+(h-p)+' '+line+' '+(w-p)+','+(h-p);salesTrend.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Seven day sales trend"><defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#19c7b5" stop-opacity=".38"/><stop offset="100%" stop-color="#19c7b5" stop-opacity="0"/></linearGradient></defs><rect width="'+w+'" height="'+h+'" fill="#081114"/>'+[0,1,2,3].map(function(i){const y=p+i*((h-p*2)/3);return '<line x1="'+p+'" y1="'+y+'" x2="'+(w-p)+'" y2="'+y+'" stroke="#1f3338" stroke-width="1"/>'}).join('')+'<polygon points="'+area+'" fill="url(#salesFill)"/><polyline points="'+line+'" fill="none" stroke="#19c7b5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'+pts.map(function(v){return '<circle cx="'+v.x+'" cy="'+v.y+'" r="5" fill="#f5fbfc" stroke="#19c7b5" stroke-width="3"><title>'+v.row.date+' '+money(v.row.netSales)+'</title></circle>'}).join('')+pts.map(function(v){return '<text x="'+v.x+'" y="'+(h-8)+'" text-anchor="middle" fill="#8ca3aa" font-size="11" font-weight="800">'+v.row.date.slice(5)+'</text>'}).join('')+'</svg>'}
    function renderPaymentMix(rows){const total=rows.reduce(function(s,x){return s+Number(x.value||0)},0)||1;const cls=['cash','online-bg','khata-bg'];paymentMix.innerHTML='<div class="mix">'+rows.map(function(x,i){const pct=Math.round((Number(x.value||0)/total)*100);return '<div class="mix-row"><strong>'+safe(x.name)+'</strong><div class="track"><div class="fill '+cls[i]+'" style="width:'+pct+'%"></div></div><span>'+money(x.value)+'</span></div>'}).join('')+'</div>'}
    function renderVolumeTrend(rows){volumeTrend.innerHTML=rows.map(function(x){return '<div class="row"><span>'+x.date+'</span><strong>Milk '+qty(x.milkKg)+' kg / Yogurt '+qty(x.yogurtKg)+' kg</strong></div>'}).join('')||'<div class="hint">No volume data</div>'}
    async function loadSupplierEntryData(){if(!token)return;const r=await fetch('owner-dashboard/supplier-entry-data',{headers:{Authorization:'Bearer '+token}});if(!r.ok)return;const d=await r.json();supplierRows=d.suppliers||[];entryDate.value=d.date||'';supplierId.innerHTML=supplierRows.map(function(s){return '<option value="'+safe(s.id)+'">'+safe(s.name)+' ('+safe(s.milkSupplyMode)+')</option>'}).join('');supplierChanged()}
    function supplierChanged(){const s=supplierRows.find(function(x){return x.id===supplierId.value});if(!s){supplierHint.textContent='';return}entryMilkType.value=s.milkSupplyMode==='SEPARATE'?'COW':'MIXED';entryMilkType.disabled=s.milkSupplyMode!=='SEPARATE';supplierHint.textContent=s.milkSupplyMode==='SEPARATE'?'Separate supplier: enter cow and buffalo separately. Cow Rs.'+s.cowRate+', buffalo Rs.'+s.buffaloRate+'. Balance '+money(s.currentBalance):'Mixed supplier: one mixed milk entry. Rate Rs.'+s.defaultRate+'. Balance '+money(s.currentBalance)}
    async function saveSupplierEntry(){entryMessage.innerHTML='';const payload={supplierId:supplierId.value,date:entryDate.value,shift:entryShift.value,milkType:entryMilkType.value,quantity:Number(entryQuantity.value||0),notes:entryNotes.value};const r=await fetch('owner-dashboard/supplier-entries',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload)});const d=await r.json().catch(function(){return {}});if(!r.ok||!d.success){entryMessage.innerHTML='<div class="error">'+safe(d.message||d.error||'Could not save entry')+'</div>';return}entryMessage.innerHTML='<div class="success">Saved '+safe(d.supplierName)+': '+qty(d.quantity)+' kg @ Rs.'+qty(d.rate)+' = '+money(d.totalAmount)+'</div>';entryQuantity.value='';entryNotes.value='';loadSummary();loadSupplierEntryData()}
    boot();
  </script>
</body>
</html>`;
}

function ownerDashboardWebsiteHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f6f8fb" />
  <title>Noon Dairy Owner Dashboard</title>
  <link rel="stylesheet" href="/api/owner-dashboard/assets/styles.css" />
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">ND</div><div><h1>Noon Dairy</h1><p>Owner Dashboard</p></div></div>
      <nav id="nav" class="nav hidden">
        <button class="nav-btn active" data-view="overview">Overview</button>
        <button class="nav-btn" data-view="sales">Sales</button>
        <button class="nav-btn" data-view="operations">Operations</button>
        <button class="nav-btn" data-view="supplier">Supplier Entry</button>
      </nav>
      <div class="server-pill"><span></span><b id="serverStatus">VPS online</b></div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div><div class="eyebrow">Private cloud control room</div><h2 id="pageTitle">Business Overview</h2><p id="stamp">Login to view live shop data.</p></div>
        <div id="toolbar" class="toolbar hidden">
          <input id="datePicker" type="date" />
          <button id="prevDate" class="btn subtle">Previous</button>
          <button id="nextDate" class="btn subtle">Next</button>
          <button id="todayDate" class="btn subtle">Today</button>
          <button id="refreshBtn" class="btn primary">Refresh</button>
          <button id="logoutBtn" class="btn danger">Logout</button>
        </div>
      </header>

      <section id="loginView" class="login">
        <div class="login-copy"><div class="eyebrow">Owner access</div><h2>Professional dashboard for your dairy shop.</h2><p>Live cloud view for sales, cash, khata, stock, suppliers, device health, and online supplier milk entry.</p></div>
        <form id="loginForm" class="login-form"><label>Username<input id="username" autocomplete="username" required /></label><label>Password / PIN<input id="password" type="password" autocomplete="current-password" required /></label><button class="btn primary" type="submit">Open Dashboard</button><div id="loginError"></div></form>
      </section>

      <section id="overview" class="view">
        <div class="hero-grid">
          <article class="hero"><div class="eyebrow">Net sales</div><strong id="heroNet">Rs. 0</strong><p>Real refunds are subtracted. Accidental corrections are shown separately.</p><div class="chips"><span id="heroBills">0 bills</span><span id="heroAvg">Avg Rs. 0</span><span id="heroShift">No shift</span><span id="heroSync">Cloud status</span></div></article>
          <article class="card"><div class="card-head"><div><div class="eyebrow">Cash Register</div><h3 id="cashState">Register</h3></div><span id="registerBadge" class="badge">Open</span></div><strong id="heroCash" class="big">Rs. 0</strong><div id="registerLines"></div></article>
        </div>
        <div id="kpis" class="kpis"></div>
        <div class="grid"><article class="card wide"><div class="card-head"><div><div class="eyebrow">Sales trend</div><h3>Last 7 Days</h3></div><span class="badge">Net</span></div><div id="salesChart" class="chart"></div></article><article class="card"><div class="card-head"><div><div class="eyebrow">Payments</div><h3>Payment Mix</h3></div></div><div id="paymentMix"></div></article></div>
      </section>

      <section id="sales" class="view hidden"><div class="grid"><article class="card"><div class="card-head"><div><div class="eyebrow">Products</div><h3>Top Products</h3></div></div><div id="topProducts"></div></article><article class="card"><div class="card-head"><div><div class="eyebrow">Expenses</div><h3>Categories</h3></div></div><div id="expenseCategories"></div></article><article class="card wide"><div class="card-head"><div><div class="eyebrow">Receipts</div><h3>Recent Sales</h3></div></div><div id="recentSales"></div></article><article class="card wide"><div class="card-head"><div><div class="eyebrow">Money</div><h3>Khata and Supplier Money</h3></div></div><div id="moneyRows"></div></article></div></section>

      <section id="operations" class="view hidden"><div class="grid"><article class="card"><div class="card-head"><div><div class="eyebrow">Sync</div><h3>Device Health</h3></div></div><div id="devices"></div></article><article class="card"><div class="card-head"><div><div class="eyebrow">Stock</div><h3>Inventory Alerts</h3></div></div><div id="inventoryAlerts"></div></article><article class="card"><div class="card-head"><div><div class="eyebrow">Farmers</div><h3>Supplier Balances</h3></div></div><div id="supplierBalances"></div></article><article class="card"><div class="card-head"><div><div class="eyebrow">Volume</div><h3>Milk / Yogurt Sold</h3></div></div><div id="volumeTrend"></div></article></div></section>

      <section id="supplier" class="view hidden"><article class="card"><div class="card-head"><div><div class="eyebrow">Cloud entry</div><h3>Supplier Milk Entry</h3><p>Saved directly on VPS. POS pulls this data before supplier work.</p></div><button id="reloadSuppliers" class="btn subtle compact">Reload Suppliers</button></div><form id="supplierForm" class="supplier-form"><label>Supplier<select id="supplierId"></select></label><label>Date<input id="entryDate" type="date" /></label><label>Shift<select id="entryShift"><option value="MORNING">Morning</option><option value="EVENING">Evening</option></select></label><label>Milk Type<select id="entryMilkType"><option value="MIXED">Mixed</option><option value="COW">Cow</option><option value="BUFFALO">Buffalo</option></select></label><label>Quantity kg<input id="entryQuantity" type="number" step="0.25" min="0.25" /></label><label>Notes<input id="entryNotes" /></label><button class="btn primary" type="submit">Save Milk Entry</button></form><p id="supplierHint"></p><div id="entryMessage"></div></article></section>
    </main>
  </div>
  <div id="toast" class="toast hidden"></div>
  <script src="/api/owner-dashboard/assets/app.js"></script>
</body>
</html>`;
}

function ownerDashboardCss() {
  return `
:root{--bg:#f5f7fa;--surface:#fff;--ink:#102026;--muted:#687b84;--line:#dbe5e9;--brand:#047d75;--blue:#1265c7;--danger:#c2414b;--good:#168a4a;--warn:#b7791f;--shadow:0 20px 45px rgba(15,32,38,.1)}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:Inter,Segoe UI,Roboto,Arial,sans-serif}.shell{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;background:#0f2428;color:white;padding:22px;display:flex;flex-direction:column;gap:22px}.brand{display:flex;align-items:center;gap:12px}.brand-mark{width:50px;height:50px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(135deg,#39d6c5,#75a9ff);color:#062326;font-weight:1000}.brand h1,.brand p,h2,h3,p{margin:0}.brand h1{font-size:21px}.brand p,.server-pill{color:#b7c9ce;font-size:13px}.nav{display:grid;gap:8px}.nav-btn{min-height:46px;border:0;border-radius:12px;background:rgba(255,255,255,.07);color:#d8e7eb;text-align:left;padding:0 14px;font-weight:900;cursor:pointer}.nav-btn.active{background:white;color:#0f2428}.server-pill{margin-top:auto;display:flex;align-items:center;gap:8px}.server-pill span{width:9px;height:9px;border-radius:999px;background:#31d47d;box-shadow:0 0 0 4px rgba(49,212,125,.18)}.main{min-width:0;padding:22px}.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.eyebrow{color:var(--brand);text-transform:uppercase;letter-spacing:.09em;font-size:11px;font-weight:1000;margin-bottom:5px}.topbar h2{font-size:30px;letter-spacing:-.04em}.topbar p,.card p,#supplierHint{color:var(--muted);font-size:13px;line-height:1.45}.toolbar{display:grid;grid-template-columns:150px repeat(5,minmax(76px,auto));gap:8px}.btn,input,select{min-height:42px;border-radius:10px;border:1px solid var(--line);background:white;color:var(--ink);padding:0 11px;font-weight:850}.btn{border:0;cursor:pointer;padding:0 14px}.btn.primary{background:linear-gradient(135deg,var(--brand),var(--blue));color:white}.btn.subtle{border:1px solid var(--line);background:white}.btn.danger{background:#fff1f2;color:var(--danger);border:1px solid #fecdd3}.compact{max-width:180px}.hidden{display:none!important}.login{min-height:430px;display:grid;grid-template-columns:1.1fr .9fr;gap:22px;align-items:center;background:linear-gradient(135deg,#fff,#eef9f8);border:1px solid var(--line);border-radius:24px;box-shadow:var(--shadow);padding:34px}.login-copy h2{font-size:44px;line-height:1.04;letter-spacing:-.05em;margin-bottom:12px}.login-copy p{color:var(--muted);font-size:16px;line-height:1.55}.login-form{display:grid;gap:12px;background:white;border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow)}label{display:grid;gap:6px;color:var(--muted);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.06em}.view{display:grid;gap:14px}.hero-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.75fr);gap:14px}.hero,.card,.metric{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}.hero{min-height:235px;padding:24px;background:linear-gradient(135deg,#073f3c,#0d5a84);color:white;position:relative;overflow:hidden}.hero:after{content:"";position:absolute;right:-90px;bottom:-120px;width:300px;height:300px;border-radius:50%;border:58px solid rgba(255,255,255,.08)}.hero .eyebrow,.hero p{color:#c9fbf4}.hero strong{display:block;font-size:56px;line-height:1;font-weight:1000;letter-spacing:-.06em;margin:10px 0;position:relative;z-index:1}.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;position:relative;z-index:1}.chips span,.badge{display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:900;background:rgba(255,255,255,.16)}.badge{background:#f6fafb;color:var(--muted);border:1px solid var(--line)}.badge.good{color:var(--good);background:#ecfdf3;border-color:#bbf7d0}.badge.warn{color:var(--warn);background:#fffbeb;border-color:#fde68a}.card{padding:16px}.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.card h3{font-size:18px}.big{display:block;font-size:36px;letter-spacing:-.04em;margin-bottom:8px}.row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}.row:last-child{border-bottom:0}.row strong{text-align:right}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{padding:15px}.metric-title{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:1000}.metric-value{display:block;font-size:27px;font-weight:1000;letter-spacing:-.04em;margin-top:8px}.metric-note{margin-top:5px;color:var(--muted);font-size:12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.wide{grid-column:span 2}.chart{min-height:270px;border-radius:14px;background:#f8fbfc;border:1px solid var(--line);overflow:hidden}svg{display:block;width:100%;height:100%}.mix-row{display:grid;grid-template-columns:74px 1fr 88px;gap:10px;align-items:center;padding:8px 0;font-size:13px}.track{height:12px;border-radius:999px;background:#edf3f5;overflow:hidden}.fill{height:100%;border-radius:999px}.cash{background:var(--brand)}.online-bg{background:var(--blue)}.khata-bg{background:#d89523}.supplier-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#102026;color:white;padding:12px 14px;border-radius:12px;box-shadow:var(--shadow);max-width:92vw}.error{color:var(--danger);background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:10px;margin-top:10px}.success{color:var(--good);background:#ecfdf3;border:1px solid #bbf7d0;border-radius:10px;padding:10px;margin-top:10px}
@media(max-width:1050px){.shell{grid-template-columns:1fr}.sidebar{position:static;height:auto}.nav{grid-template-columns:repeat(4,minmax(0,1fr))}.topbar{flex-direction:column}.toolbar{width:100%;grid-template-columns:repeat(3,minmax(0,1fr))}.toolbar input{grid-column:1/-1}.hero-grid,.grid{grid-template-columns:1fr}.wide{grid-column:auto}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.main{padding:12px}.sidebar{padding:14px}.nav{grid-template-columns:repeat(2,minmax(0,1fr))}.topbar h2{font-size:24px}.toolbar,.kpis,.supplier-form{grid-template-columns:1fr}.login{grid-template-columns:1fr;padding:18px}.login-copy h2{font-size:32px}.hero strong{font-size:40px}.mix-row{grid-template-columns:64px 1fr 74px}}
`;
}

function ownerDashboardJs() {
  return `
(function () {
  var token = localStorage.getItem('ownerAccessToken') || '';
  var suppliers = [];
  var activeView = 'overview';
  var timer = null;
  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return 'Rs. ' + Math.round(Number(n || 0)).toLocaleString('en-PK'); };
  var qty = function (n) { return Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 }); };
  var safe = function (text) { return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
  var todayIso = function () { return new Date().toISOString().slice(0, 10); };
  function toast(text) { $('toast').textContent = text; $('toast').classList.remove('hidden'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(function () { $('toast').classList.add('hidden'); }, 2800); }
  function setLoading(value) { $('refreshBtn').disabled = value; $('refreshBtn').textContent = value ? 'Loading...' : 'Refresh'; }
  function row(left, right, note) { return '<div class="row"><span>' + left + (note ? '<br><small>' + note + '</small>' : '') + '</span><strong>' + right + '</strong></div>'; }
  function showView(view) {
    activeView = view;
    ['overview', 'sales', 'operations', 'supplier'].forEach(function (id) { $(id).classList.add('hidden'); });
    $(view).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(function (btn) { btn.classList.toggle('active', btn.dataset.view === view); });
    $('pageTitle').textContent = { overview: 'Business Overview', sales: 'Sales and Money', operations: 'Operations Health', supplier: 'Supplier Milk Entry' }[view] || 'Dashboard';
    if (view === 'supplier') loadSuppliers();
  }
  function boot() {
    if (!token) return;
    $('loginView').classList.add('hidden'); $('nav').classList.remove('hidden'); $('toolbar').classList.remove('hidden');
    showView(activeView); loadSummary(); loadSuppliers(); timer = setInterval(loadSummary, 60000);
  }
  async function doLogin(event) {
    event.preventDefault(); $('loginError').innerHTML = '';
    try {
      var res = await fetch('auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('username').value, password: $('password').value }) });
      if (!res.ok) { $('loginError').innerHTML = '<div class="error">Login failed. Use admin or manager login.</div>'; return; }
      var data = await res.json(); token = data.accessToken; localStorage.setItem('ownerAccessToken', token); boot();
    } catch (err) { $('loginError').innerHTML = '<div class="error">Network error. Check VPS connection.</div>'; }
  }
  function logout() { localStorage.removeItem('ownerAccessToken'); clearInterval(timer); location.reload(); }
  async function loadSummary() {
    if (!token) return; setLoading(true);
    try {
      var query = $('datePicker').value ? '?date=' + encodeURIComponent($('datePicker').value) : '';
      var res = await fetch('owner-dashboard/summary' + query, { headers: { Authorization: 'Bearer ' + token } });
      if (res.status === 401 || res.status === 403) { localStorage.removeItem('ownerAccessToken'); location.reload(); return; }
      if (!res.ok) throw new Error('summary failed');
      renderSummary(await res.json());
    } catch (err) { toast('Could not refresh dashboard.'); } finally { setLoading(false); }
  }
  function renderSummary(d) {
    $('datePicker').value = d.date;
    $('stamp').textContent = 'Date ' + d.date + ' | Updated ' + new Date(d.generatedAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
    $('heroNet').textContent = money(d.sales.netSales); $('heroBills').textContent = d.sales.billCount + ' bills'; $('heroAvg').textContent = 'Avg ' + money(d.sales.avgBill);
    $('heroShift').textContent = d.shift ? 'Shift open ' + Math.floor(d.shift.minutesOpen / 60) + 'h ' + (d.shift.minutesOpen % 60) + 'm' : 'No open shift';
    $('heroSync').textContent = (d.devices || []).some(function (x) { return x.health === 'online'; }) ? 'POS online' : 'No live POS';
    $('cashState').textContent = d.register && d.register.isClosed ? 'Closed register' : 'Open register';
    $('registerBadge').textContent = d.register && d.register.isClosed ? 'Closed' : 'Open'; $('registerBadge').className = 'badge ' + (d.register && d.register.isClosed ? 'warn' : 'good');
    $('heroCash').textContent = money(d.register && d.register.expectedCash);
    $('registerLines').innerHTML = row('Opening cash', money(d.register && d.register.openingCash)) + row('Cash in', money(d.register && d.register.cashIn)) + row('Cash out', money(d.register && d.register.cashOut)) + row('Online expected', money(d.register && d.register.expectedOnline));
    var kpis = [['Gross Sales', money(d.sales.grossSales), d.sales.billCount + ' bills'], ['Real Refunds', money(d.sales.refunds), 'corrections separate'], ['Online Sales', money(d.sales.onlineSales), 'expected ' + money(d.register && d.register.expectedOnline)], ['Khata Sales', money(d.sales.khataSales), d.khata.customersOwing + ' owing customers'], ['Milk Bought', qty(d.suppliers.milkKgToday) + ' kg', money(d.suppliers.milkPurchaseToday)], ['Supplier Payable', money(d.suppliers.payableToSuppliers), d.suppliers.activeSuppliers + ' suppliers'], ['Expenses', money(d.expenses.today), 'selected date'], ['Stock Value', money(d.inventory.stockValue), 'Milk ' + qty(d.inventory.milkKg) + ' kg, yogurt ' + qty(d.inventory.yogurtKg) + ' kg']];
    $('kpis').innerHTML = kpis.map(function (k) { return '<article class="metric"><p class="metric-title">' + k[0] + '</p><span class="metric-value">' + k[1] + '</span><p class="metric-note">' + k[2] + '</p></article>'; }).join('');
    renderSalesChart(d.charts.salesTrend || []); renderPaymentMix(d.charts.paymentMix || []);
    renderRows('topProducts', d.charts.topProducts || [], function (x) { return row(safe(x.name), money(x.revenue), qty(x.quantity) + ' ' + safe(x.unit)); }, 'No product sales.');
    renderRows('expenseCategories', d.charts.expenseByCategory || [], function (x) { return row(safe(x.category).replaceAll('_', ' '), money(x.amount)); }, 'No expenses.');
    renderRows('recentSales', d.recentSales || [], function (x) { return row('<b>' + safe(x.billNumber) + '</b>', money(x.grandTotal), safe(x.paymentType) + ' / ' + safe(x.customerName)); }, 'No sales for this date.');
    $('moneyRows').innerHTML = row('Customer khata due', money(d.khata.totalDue), d.khata.customersOwing + ' customers') + row('Supplier payable', money(d.suppliers.payableToSuppliers), d.suppliers.activeSuppliers + ' suppliers') + row('Supplier paid today', money(d.suppliers.supplierPaymentsToday), 'cash out') + row('Correction returns', money(d.sales.correctionReturns.amount), d.sales.correctionReturns.count + ' entries');
    renderRows('devices', d.devices || [], function (x) { return row(safe(x.deviceName), '<span class="badge ' + (x.health === 'online' ? 'good' : 'warn') + '">' + safe(x.health) + ' ' + (x.minutesSinceSeen == null ? '-' : x.minutesSinceSeen) + 'm</span>'); }, 'No registered devices.');
    renderRows('inventoryAlerts', d.inventory.alerts || [], function (x) { return row(safe(x.name), qty(x.stock) + ' ' + safe(x.unit), 'threshold ' + qty(x.threshold)); }, 'No low stock alerts.');
    renderRows('supplierBalances', d.charts.supplierBalances || [], function (x) { var rate = x.mode === 'SEPARATE' ? 'Cow ' + money(x.cowRate) + ' / Buffalo ' + money(x.buffaloRate) : 'Mixed ' + money(x.defaultRate); return row(safe(x.name), money(x.balance), rate); }, 'No active suppliers.');
    renderRows('volumeTrend', d.charts.salesTrend || [], function (x) { return row(x.date, 'Milk ' + qty(x.milkKg) + ' kg / Yogurt ' + qty(x.yogurtKg) + ' kg'); }, 'No volume data.');
  }
  function renderRows(id, rows, renderer, empty) { $(id).innerHTML = rows.length ? rows.map(renderer).join('') : '<p>' + empty + '</p>'; }
  function renderPaymentMix(rows) {
    var total = rows.reduce(function (s, x) { return s + Number(x.value || 0); }, 0) || 1; var cls = ['cash', 'online-bg', 'khata-bg'];
    $('paymentMix').innerHTML = rows.map(function (x, i) { var pct = Math.round(Number(x.value || 0) / total * 100); return '<div class="mix-row"><b>' + safe(x.name) + '</b><div class="track"><div class="fill ' + cls[i] + '" style="width:' + pct + '%"></div></div><span>' + money(x.value) + '</span></div>'; }).join('');
  }
  function renderSalesChart(rows) {
    if (!rows.length) { $('salesChart').innerHTML = '<p style="padding:16px">No sales trend yet.</p>'; return; }
    var w = 820, h = 270, p = 34, max = Math.max(1, ...rows.map(function (x) { return Number(x.netSales || 0); }));
    var pts = rows.map(function (x, i) { return { x: p + i * (w - p * 2) / Math.max(1, rows.length - 1), y: h - p - (Number(x.netSales || 0) / max) * (h - p * 2), row: x }; });
    var line = pts.map(function (v) { return v.x.toFixed(1) + ',' + v.y.toFixed(1); }).join(' '); var area = p + ',' + (h - p) + ' ' + line + ' ' + (w - p) + ',' + (h - p);
    $('salesChart').innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#047d75" stop-opacity=".26"/><stop offset="100%" stop-color="#047d75" stop-opacity="0"/></linearGradient></defs><rect width="' + w + '" height="' + h + '" fill="#f8fbfc"/>' + [0,1,2,3].map(function(i){var y=p+i*((h-p*2)/3);return '<line x1="'+p+'" y1="'+y+'" x2="'+(w-p)+'" y2="'+y+'" stroke="#d9e3e7"/>';}).join('') + '<polygon points="' + area + '" fill="url(#fill)"/><polyline points="' + line + '" fill="none" stroke="#047d75" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' + pts.map(function(v){return '<circle cx="'+v.x+'" cy="'+v.y+'" r="6" fill="#fff" stroke="#047d75" stroke-width="4"><title>'+v.row.date+' '+money(v.row.netSales)+'</title></circle>';}).join('') + pts.map(function(v){return '<text x="'+v.x+'" y="'+(h-10)+'" text-anchor="middle" fill="#637780" font-size="12" font-weight="800">'+v.row.date.slice(5)+'</text>';}).join('') + '</svg>';
  }
  async function loadSuppliers() { if (!token) return; var res = await fetch('owner-dashboard/supplier-entry-data', { headers: { Authorization: 'Bearer ' + token } }); if (!res.ok) return; var data = await res.json(); suppliers = data.suppliers || []; $('entryDate').value = data.date || todayIso(); $('supplierId').innerHTML = suppliers.map(function (s) { return '<option value="' + safe(s.id) + '">' + safe(s.name) + ' (' + safe(s.milkSupplyMode) + ')</option>'; }).join(''); supplierChanged(); }
  function supplierChanged() { var s = suppliers.find(function (x) { return x.id === $('supplierId').value; }); if (!s) { $('supplierHint').textContent = ''; return; } $('entryMilkType').value = s.milkSupplyMode === 'SEPARATE' ? 'COW' : 'MIXED'; $('entryMilkType').disabled = s.milkSupplyMode !== 'SEPARATE'; $('supplierHint').textContent = s.milkSupplyMode === 'SEPARATE' ? 'Separate supplier: cow Rs.' + s.cowRate + ', buffalo Rs.' + s.buffaloRate + '. Balance ' + money(s.currentBalance) : 'Mixed supplier: rate Rs.' + s.defaultRate + '. Balance ' + money(s.currentBalance); }
  async function saveSupplier(event) { event.preventDefault(); $('entryMessage').innerHTML = ''; var payload = { supplierId: $('supplierId').value, date: $('entryDate').value, shift: $('entryShift').value, milkType: $('entryMilkType').value, quantity: Number($('entryQuantity').value || 0), notes: $('entryNotes').value }; var res = await fetch('owner-dashboard/supplier-entries', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload) }); var data = await res.json().catch(function () { return {}; }); if (!res.ok || !data.success) { $('entryMessage').innerHTML = '<div class="error">' + safe(data.message || data.error || 'Could not save entry') + '</div>'; return; } $('entryMessage').innerHTML = '<div class="success">Saved ' + safe(data.supplierName) + ': ' + qty(data.quantity) + ' kg @ Rs.' + qty(data.rate) + ' = ' + money(data.totalAmount) + '</div>'; $('entryQuantity').value = ''; $('entryNotes').value = ''; loadSummary(); loadSuppliers(); }
  document.querySelectorAll('.nav-btn').forEach(function (btn) { btn.addEventListener('click', function () { showView(btn.dataset.view); }); }); $('loginForm').addEventListener('submit', doLogin); $('logoutBtn').addEventListener('click', logout); $('refreshBtn').addEventListener('click', loadSummary); $('prevDate').addEventListener('click', function () { var d = $('datePicker').value ? new Date($('datePicker').value + 'T00:00:00') : new Date(); d.setDate(d.getDate() - 1); $('datePicker').value = d.toISOString().slice(0, 10); loadSummary(); }); $('nextDate').addEventListener('click', function () { var d = $('datePicker').value ? new Date($('datePicker').value + 'T00:00:00') : new Date(); d.setDate(d.getDate() + 1); $('datePicker').value = d.toISOString().slice(0, 10); loadSummary(); }); $('todayDate').addEventListener('click', function () { $('datePicker').value = todayIso(); loadSummary(); }); $('datePicker').addEventListener('change', loadSummary); $('reloadSuppliers').addEventListener('click', loadSuppliers); $('supplierId').addEventListener('change', supplierChanged); $('supplierForm').addEventListener('submit', saveSupplier); boot();
})();
`;
}

@ApiTags('owner-dashboard')
@Controller('owner-dashboard')
export class OwnerDashboardController {
  constructor(private readonly service: OwnerDashboardService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page() {
    return ownerDashboardHtml();
    /* return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Noon Dairy Owner Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      --bg:#071012; --panel:#101a1d; --panel2:#142226; --line:#26383d;
      --text:#f7fbfc; --muted:#91a8ae; --soft:#c7d7db;
      --brand:#2dd4bf; --brand2:#60a5fa; --good:#22c55e; --warn:#f59e0b; --bad:#ef4444;
      --cash:#2dd4bf; --online:#60a5fa; --khata:#f59e0b; --expense:#fb7185;
      --shadow:0 14px 40px rgba(0,0,0,.28);
    }
    * { box-sizing:border-box; }
    body {
      margin:0;
      font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;
      background:
        radial-gradient(circle at top left, rgba(45,212,191,.16), transparent 34%),
        linear-gradient(160deg, #071012 0%, #0b1519 50%, #101318 100%);
      color:var(--text);
    }
    header {
      position:sticky; top:0; z-index:20;
      padding:14px 16px 10px;
      border-bottom:1px solid rgba(255,255,255,.08);
      background:rgba(7,16,18,.9);
      backdrop-filter: blur(14px);
    }
    .topbar { max-width:1180px; margin:0 auto; display:flex; justify-content:space-between; gap:12px; align-items:center; }
    h1 { font-size:19px; margin:0; letter-spacing:.2px; }
    .subhead { color:var(--muted); font-size:12px; margin-top:4px; }
    main { padding:14px; max-width:1180px; margin:0 auto 32px; }
    nav { max-width:1180px; margin:10px auto 0; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
    .navbtn { background:var(--panel2); color:var(--soft); border:1px solid var(--line); }
    .navbtn.active { background:linear-gradient(135deg,var(--brand),var(--brand2)); color:#031214; border:0; }
    .toolbar { display:grid; grid-template-columns:1fr 120px 120px; gap:8px; align-items:center; margin-top:12px; }
    .login, .card {
      background:linear-gradient(180deg, rgba(20,34,38,.96), rgba(14,24,27,.96));
      border:1px solid rgba(255,255,255,.09);
      border-radius:14px;
      padding:14px;
      box-shadow:var(--shadow);
    }
    .hero {
      display:grid; grid-template-columns:1.3fr .7fr; gap:12px; margin-bottom:12px;
    }
    .hero-main {
      min-height:160px; padding:18px; border-radius:18px; overflow:hidden; position:relative;
      background:linear-gradient(135deg, rgba(45,212,191,.22), rgba(96,165,250,.14)), var(--panel);
      border:1px solid rgba(255,255,255,.1); box-shadow:var(--shadow);
    }
    .hero-main:after {
      content:""; position:absolute; right:-40px; top:-50px; width:180px; height:180px;
      border-radius:50%; background:rgba(45,212,191,.16);
    }
    .hero-title { color:var(--muted); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.8px; }
    .hero-value { font-size:42px; line-height:1; font-weight:900; margin:10px 0 8px; }
    .hero-row { display:flex; gap:10px; flex-wrap:wrap; color:var(--soft); font-size:13px; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
    .two { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .wide { grid-column:span 2; }
    .label { color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:900; letter-spacing:.7px; }
    .value { display:block; font-size:25px; font-weight:900; margin-top:7px; }
    .hint { color:var(--muted); font-size:12px; margin-top:4px; }
    input, button, select {
      width:100%; min-height:46px; border-radius:11px; border:1px solid var(--line);
      background:#081114; color:var(--text); padding:0 12px; font-weight:800; font-size:14px;
    }
    button { background:linear-gradient(135deg,var(--brand),var(--brand2)); color:#041314; border:0; cursor:pointer; }
    button.secondary { background:#17262b; color:var(--text); border:1px solid var(--line); }
    button.danger { background:#442026; color:#fecdd3; border:1px solid #7f1d1d; }
    .row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid rgba(255,255,255,.08); font-size:13px; }
    .row:last-child { border-bottom:0; }
    .row strong { font-size:13px; }
    .pill { display:inline-flex; align-items:center; gap:5px; min-height:26px; padding:0 9px; border-radius:999px; background:#0b1417; border:1px solid var(--line); font-size:11px; font-weight:900; color:var(--soft); }
    .online { color:var(--good); } .stale { color:var(--warn); } .offline, .revoked, .never_seen { color:var(--bad); }
    .bar-wrap { display:flex; align-items:end; gap:7px; height:160px; padding-top:12px; }
    .bar { flex:1; min-width:0; border-radius:7px 7px 3px 3px; background:linear-gradient(180deg,var(--brand2),var(--brand)); position:relative; }
    .bar span { position:absolute; left:50%; bottom:-22px; transform:translateX(-50%); color:var(--muted); font-size:10px; font-weight:800; white-space:nowrap; }
    .mix { display:grid; gap:9px; margin-top:10px; }
    .mix-row { display:grid; grid-template-columns:70px 1fr 84px; gap:8px; align-items:center; font-size:12px; }
    .track { height:10px; border-radius:999px; background:#0b1417; overflow:hidden; border:1px solid var(--line); }
    .fill { height:100%; width:0%; border-radius:999px; background:var(--brand); }
    .cash { background:var(--cash); } .online-bg { background:var(--online); } .khata-bg { background:var(--khata); }
    .section-title { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; }
    .hidden { display:none !important; }
    .error { color:#fecaca; background:#451a1a; border:1px solid #7f1d1d; border-radius:10px; padding:10px; margin-top:10px; }
    .success { color:#bbf7d0; background:#13341f; border:1px solid #166534; border-radius:10px; padding:10px; margin-top:10px; }
    @media (max-width:900px){
      .hero{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,minmax(0,1fr));}.wide{grid-column:span 2;}
      .toolbar{grid-template-columns:1fr 1fr}.toolbar button{grid-column:span 1;}
    }
    @media (max-width:560px){
      header{padding:12px 10px 9px}.topbar{align-items:flex-start; flex-direction:column;}
      main{padding:10px}.grid,.two{grid-template-columns:1fr}.wide{grid-column:span 1;}
      nav{grid-template-columns:repeat(2,minmax(0,1fr)); padding:0 10px;}
      .hero-value{font-size:34px}.toolbar{grid-template-columns:1fr}.mix-row{grid-template-columns:64px 1fr 72px;}
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div>
        <h1>Noon Dairy Owner Dashboard</h1>
        <div class="subhead" id="stamp">Private VPS view</div>
      </div>
      <div style="display:flex;gap:8px;width:100%;max-width:360px">
        <button class="secondary" onclick="loadSummary()">Refresh</button>
        <button class="danger" onclick="logout()">Logout</button>
      </div>
    </div>
    <nav id="nav" class="hidden">
      <button id="tabDashboard" class="navbtn" onclick="showTab('dashboard')">Dashboard</button>
      <button id="tabMoney" class="navbtn" onclick="showTab('money')">Money</button>
      <button id="tabOperations" class="navbtn" onclick="showTab('operations')">Operations</button>
      <button id="tabSupplierEntry" class="navbtn" onclick="showTab('supplierEntry')">Supplier Entry</button>
    </nav>
  </header>
  <main>
    <section id="login" class="login">
      <div class="section-title">
        <div>
          <div class="label">Owner Login</div>
          <div class="hint">Use admin or manager login. This page is for mobile monitoring.</div>
        </div>
      </div>
      <div class="grid">
        <input id="username" placeholder="Username" autocomplete="username" />
        <input id="password" placeholder="Password/PIN" type="password" autocomplete="current-password" />
        <button onclick="login()">Login</button>
      </div>
      <div id="loginError"></div>
    </section>
    <section id="dashboard" class="hidden">
      <div class="toolbar">
        <input id="summaryDate" type="date" onchange="loadSummary()" />
        <button class="secondary" onclick="moveDate(-1)">Previous</button>
        <button class="secondary" onclick="moveDate(1)">Next</button>
      </div>
      <div class="hero" style="margin-top:12px">
        <div class="hero-main">
          <div class="hero-title">Net Sales Today</div>
          <div class="hero-value" id="heroNet">Rs. 0</div>
          <div class="hero-row">
            <span class="pill" id="heroBills">0 bills</span>
            <span class="pill" id="heroAvg">Avg Rs. 0</span>
            <span class="pill" id="heroShift">Shift status</span>
          </div>
        </div>
        <div class="card">
          <div class="label">Cash Register</div>
          <span class="value" id="heroCash">Rs. 0</span>
          <div class="hint" id="heroCashHint">Expected cash</div>
          <div class="mix" id="registerLines"></div>
        </div>
      </div>
      <div class="grid" id="cards"></div>
      <div class="grid" style="margin-top:10px">
        <div class="card wide">
          <div class="section-title"><div class="label">7 Day Sales Trend</div><span class="pill">Net sales</span></div>
          <div class="bar-wrap" id="salesTrend"></div>
        </div>
        <div class="card wide">
          <div class="section-title"><div class="label">Payment Mix</div><span class="pill">Cash / Online / Khata</span></div>
          <div id="paymentMix"></div>
        </div>
      </div>
    </section>
    <section id="money" class="hidden">
      <div class="toolbar">
        <input id="moneyDate" type="date" onchange="syncDateFrom('moneyDate')" />
        <button class="secondary" onclick="moveDate(-1)">Previous</button>
        <button class="secondary" onclick="moveDate(1)">Next</button>
      </div>
      <div class="grid" style="margin-top:12px">
        <div class="card wide"><div class="label">Top Products</div><div id="topProducts"></div></div>
        <div class="card wide"><div class="label">Expense Categories</div><div id="expenseCategories"></div></div>
        <div class="card wide"><div class="label">Recent Sales</div><div id="recentSales"></div></div>
        <div class="card wide"><div class="label">Khata / Supplier Money</div><div id="moneyRows"></div></div>
      </div>
    </section>
    <section id="operations" class="hidden">
      <div class="grid">
        <div class="card wide"><div class="label">Device Health</div><div id="devices"></div></div>
        <div class="card wide"><div class="label">Inventory Alerts</div><div id="inventoryAlerts"></div></div>
        <div class="card wide"><div class="label">Supplier Balances</div><div id="supplierBalances"></div></div>
        <div class="card wide"><div class="label">Milk / Yogurt Volume</div><div id="volumeTrend"></div></div>
      </div>
    </section>
    <section id="supplierEntry" class="hidden">
      <div class="card">
        <div class="section-title">
          <div>
            <div class="label">Online Supplier Milk Entry</div>
            <div class="hint">This writes directly to VPS cloud. POS supplier tab will pull it.</div>
          </div>
          <button class="secondary" style="max-width:150px" onclick="loadSupplierEntryData()">Refresh</button>
        </div>
        <div class="grid" style="margin-top:10px">
          <select id="supplierId" onchange="supplierChanged()"></select>
          <input id="entryDate" type="date" />
          <select id="entryShift"><option value="MORNING">Morning</option><option value="EVENING">Evening</option></select>
          <select id="entryMilkType"><option value="MIXED">Mixed</option><option value="COW">Cow</option><option value="BUFFALO">Buffalo</option></select>
          <input id="entryQuantity" type="number" step="0.25" min="0.25" placeholder="Milk kg" />
          <input id="entryNotes" placeholder="Notes optional" />
          <button onclick="saveSupplierEntry()">Save Milk Entry</button>
        </div>
        <div class="muted" id="supplierHint" style="margin-top:10px"></div>
        <div id="entryMessage"></div>
      </div>
    </section>
  </main>
  <script>
    let token = localStorage.getItem('ownerAccessToken') || '';
    let supplierRows = [];
    let currentSummary = null;
    if (token) { document.getElementById('login').classList.add('hidden'); document.getElementById('nav').classList.remove('hidden'); showTab('dashboard'); loadSummary(); loadSupplierEntryData(); }
    const money = (n) => 'Rs. ' + Math.round(Number(n || 0)).toLocaleString('en-PK');
    const qty = (n) => Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });
    function safe(text) {
      return String(text ?? '').replace(/[&<>"']/g, function(ch) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]);
      });
    }
    function showTab(id) {
      ['dashboard','money','operations','supplierEntry'].forEach(function(section){ document.getElementById(section).classList.add('hidden'); });
      ['tabDashboard','tabMoney','tabOperations','tabSupplierEntry'].forEach(function(tab){ document.getElementById(tab).classList.remove('active'); });
      const activeMap = { dashboard:'tabDashboard', money:'tabMoney', operations:'tabOperations', supplierEntry:'tabSupplierEntry' };
      document.getElementById(activeMap[id]).classList.add('active');
      document.getElementById(id).classList.remove('hidden');
      if (id === 'supplierEntry') loadSupplierEntryData();
    }
    function logout() {
      localStorage.removeItem('ownerAccessToken');
      location.reload();
    }
    async function login() {
      document.getElementById('loginError').innerHTML = '';
      const res = await fetch('auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username:username.value, password:password.value }) });
      if (!res.ok) { document.getElementById('loginError').innerHTML = '<div class="error">Login failed. Use backend admin/manager login.</div>'; return; }
      const data = await res.json(); token = data.accessToken; localStorage.setItem('ownerAccessToken', token);
      document.getElementById('login').classList.add('hidden'); document.getElementById('nav').classList.remove('hidden'); showTab('dashboard'); loadSummary(); loadSupplierEntryData();
    }
    function selectedDate() {
      return summaryDate.value || moneyDate.value || '';
    }
    function syncDateControls(date) {
      summaryDate.value = date || '';
      moneyDate.value = date || '';
    }
    function syncDateFrom(id) {
      syncDateControls(document.getElementById(id).value);
      loadSummary();
    }
    function moveDate(days) {
      const base = selectedDate() ? new Date(selectedDate() + 'T00:00:00') : new Date();
      base.setDate(base.getDate() + days);
      const next = base.toISOString().slice(0, 10);
      syncDateControls(next);
      loadSummary();
    }
    async function loadSummary() {
      if (!token) return;
      const query = selectedDate() ? '?date=' + encodeURIComponent(selectedDate()) : '';
      const res = await fetch('owner-dashboard/summary' + query, { headers:{ Authorization:'Bearer ' + token } });
      if (res.status === 401 || res.status === 403) { localStorage.removeItem('ownerAccessToken'); location.reload(); return; }
      const d = await res.json(); currentSummary = d; syncDateControls(d.date);
      stamp.textContent = 'Date ' + d.date + ' | Updated ' + new Date(d.generatedAt).toLocaleString();
      heroNet.textContent = money(d.sales.netSales);
      heroBills.textContent = d.sales.billCount + ' bills';
      heroAvg.textContent = 'Avg ' + money(d.sales.avgBill);
      heroShift.textContent = d.shift ? 'Open ' + Math.floor(d.shift.minutesOpen / 60) + 'h ' + (d.shift.minutesOpen % 60) + 'm' : 'No open shift';
      heroCash.textContent = money(d.register?.expectedCash);
      heroCashHint.textContent = d.register?.isClosed ? 'Register closed' : 'Expected cash in drawer';
      registerLines.innerHTML = [
        ['Opening', money(d.register?.openingCash)],
        ['Cash In', money(d.register?.cashIn)],
        ['Cash Out', money(d.register?.cashOut)],
        ['Online Expected', money(d.register?.expectedOnline)]
      ].map(function(row){ return '<div class="row"><span>'+row[0]+'</span><strong>'+row[1]+'</strong></div>'; }).join('');
      cards.innerHTML = [
        ['Gross Sales', money(d.sales.grossSales), d.sales.billCount + ' bills'],
        ['Net Sales', money(d.sales.netSales), 'refunds ' + money(d.sales.refunds)],
        ['Expected Cash', money(d.register?.expectedCash), d.register?.isClosed ? 'register closed' : 'register open'],
        ['Online', money(d.sales.onlineSales), 'expected ' + money(d.register?.expectedOnline)],
        ['Khata Due', money(d.khata.totalDue), d.khata.customersOwing + ' customers'],
        ['Milk Bought', d.suppliers.milkKgToday + ' kg', money(d.suppliers.milkPurchaseToday)],
        ['Expenses', money(d.expenses.today), 'today'],
        ['Milk Stock', d.inventory.milkKg + ' kg', 'yogurt ' + d.inventory.yogurtKg + ' kg'],
      ].map(function(row){ return '<div class="card"><div class="label">'+row[0]+'</div><span class="value">'+row[1]+'</span><div class="hint">'+row[2]+'</div></div>'; }).join('');
      renderTrend(d.charts.salesTrend || []);
      renderPaymentMix(d.charts.paymentMix || []);
      renderRows('devices', d.devices || [], function(x) {
        return '<div class="row"><span>'+safe(x.deviceName)+'</span><span class="pill '+x.health+'">'+safe(x.health)+' '+(x.minutesSinceSeen ?? '-')+'m</span></div>';
      }, 'No devices');
      renderRows('recentSales', d.recentSales || [], function(x) {
        return '<div class="row"><span><strong>'+safe(x.billNumber)+'</strong><br><span class="hint">'+safe(x.paymentType)+' · '+safe(x.customerName)+'</span></span><strong>'+money(x.grandTotal)+'</strong></div>';
      }, 'No sales for this date');
      renderRows('topProducts', d.charts.topProducts || [], function(x) {
        return '<div class="row"><span>'+safe(x.name)+'<br><span class="hint">'+qty(x.quantity)+' '+safe(x.unit)+'</span></span><strong>'+money(x.revenue)+'</strong></div>';
      }, 'No product sales');
      renderRows('expenseCategories', d.charts.expenseByCategory || [], function(x) {
        return '<div class="row"><span>'+safe(x.category).replaceAll('_',' ')+'</span><strong>'+money(x.amount)+'</strong></div>';
      }, 'No expenses');
      renderRows('inventoryAlerts', d.inventory.alerts || [], function(x) {
        const tone = Number(x.stock) <= 0 ? 'offline' : 'stale';
        return '<div class="row"><span>'+safe(x.name)+'<br><span class="hint">threshold '+qty(x.threshold)+' '+safe(x.unit)+'</span></span><span class="pill '+tone+'">'+qty(x.stock)+' '+safe(x.unit)+'</span></div>';
      }, 'No low stock alerts');
      renderRows('supplierBalances', d.charts.supplierBalances || [], function(x) {
        const rateText = x.mode === 'SEPARATE' ? 'Cow '+money(x.cowRate)+' · Buffalo '+money(x.buffaloRate) : 'Mixed '+money(x.defaultRate);
        return '<div class="row"><span>'+safe(x.name)+'<br><span class="hint">'+safe(rateText)+'</span></span><strong>'+money(x.balance)+'</strong></div>';
      }, 'No active suppliers');
      moneyRows.innerHTML = [
        ['Customer Khata Due', money(d.khata.totalDue), d.khata.customersOwing + ' customers'],
        ['Supplier Payable', money(d.suppliers.payableToSuppliers), d.suppliers.activeSuppliers + ' suppliers'],
        ['Supplier Paid Today', money(d.suppliers.supplierPaymentsToday), 'cash out'],
        ['Correction Returns', money(d.sales.correctionReturns.amount), d.sales.correctionReturns.count + ' entries']
      ].map(function(row){ return '<div class="row"><span>'+row[0]+'<br><span class="hint">'+row[2]+'</span></span><strong>'+row[1]+'</strong></div>'; }).join('');
      renderVolumeTrend(d.charts.salesTrend || []);
    }
    function renderRows(id, rows, render, emptyText) {
      document.getElementById(id).innerHTML = rows.length ? rows.map(render).join('') : '<div class="hint">'+emptyText+'</div>';
    }
    function renderTrend(rows) {
      const max = Math.max(1, ...rows.map(function(x){ return Number(x.netSales || 0); }));
      salesTrend.innerHTML = rows.map(function(x) {
        const h = Math.max(4, Math.round((Number(x.netSales || 0) / max) * 135));
        return '<div class="bar" style="height:'+h+'px"><span>'+x.date.slice(5)+'</span></div>';
      }).join('');
    }
    function renderPaymentMix(rows) {
      const total = rows.reduce(function(sum, x){ return sum + Number(x.value || 0); }, 0) || 1;
      const classes = ['cash', 'online-bg', 'khata-bg'];
      paymentMix.innerHTML = '<div class="mix">' + rows.map(function(x, i) {
        const pct = Math.round((Number(x.value || 0) / total) * 100);
        return '<div class="mix-row"><strong>'+safe(x.name)+'</strong><div class="track"><div class="fill '+classes[i]+'" style="width:'+pct+'%"></div></div><span>'+money(x.value)+'</span></div>';
      }).join('') + '</div>';
    }
    function renderVolumeTrend(rows) {
      volumeTrend.innerHTML = rows.map(function(x) {
        return '<div class="row"><span>'+x.date+'</span><strong>Milk '+qty(x.milkKg)+' kg · Yogurt '+qty(x.yogurtKg)+' kg</strong></div>';
      }).join('') || '<div class="hint">No volume data</div>';
    }
    async function loadSupplierEntryData() {
      if (!token) return;
      const res = await fetch('owner-dashboard/supplier-entry-data', { headers:{ Authorization:'Bearer ' + token } });
      if (!res.ok) return;
      const data = await res.json(); supplierRows = data.suppliers || []; entryDate.value = data.date || '';
      supplierId.innerHTML = supplierRows.map(s => '<option value="'+s.id+'">'+s.name+' ('+s.milkSupplyMode+')</option>').join('');
      supplierChanged();
    }
    function supplierChanged() {
      const s = supplierRows.find(x => x.id === supplierId.value);
      if (!s) { supplierHint.textContent = ''; return; }
      entryMilkType.value = s.milkSupplyMode === 'SEPARATE' ? 'COW' : 'MIXED';
      entryMilkType.disabled = s.milkSupplyMode !== 'SEPARATE';
      supplierHint.textContent = s.milkSupplyMode === 'SEPARATE'
        ? 'Separate supplier: enter cow and buffalo separately. Cow Rs.'+s.cowRate+', buffalo Rs.'+s.buffaloRate+'. Balance '+money(s.currentBalance)
        : 'Mixed supplier: one mixed milk entry. Rate Rs.'+s.defaultRate+'. Balance '+money(s.currentBalance);
    }
    async function saveSupplierEntry() {
      entryMessage.innerHTML = '';
      const payload = { supplierId:supplierId.value, date:entryDate.value, shift:entryShift.value, milkType:entryMilkType.value, quantity:Number(entryQuantity.value || 0), notes:entryNotes.value };
      const res = await fetch('owner-dashboard/supplier-entries', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body:JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { entryMessage.innerHTML = '<div class="error">'+(data.message || data.error || 'Could not save entry')+'</div>'; return; }
      entryMessage.innerHTML = '<div class="card" style="margin-top:10px;border-color:var(--good)">Saved '+data.supplierName+': '+data.quantity+' kg @ Rs.'+data.rate+' = '+money(data.totalAmount)+'</div>';
      entryQuantity.value = ''; entryNotes.value = ''; loadSummary(); loadSupplierEntryData();
    }
  </script>
</body>
</html>`; */
  }

  @Get('assets/styles.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  styles() {
    return ownerDashboardCss();
  }

  @Get('assets/app.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  script() {
    return ownerDashboardJs();
  }

  @Get('summary')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  summary(@Query('date') date?: string) {
    return this.service.getSummary(date);
  }

  @Get('supplier-entry-data')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  supplierEntryData() {
    return this.service.getSupplierEntryData();
  }

  @Post('supplier-entries')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  supplierEntry(@Body() dto: any, @Req() req: any) {
    return this.service.createSupplierMilkEntry(dto, req.user);
  }
}

@Module({
  providers: [OwnerDashboardService],
  controllers: [OwnerDashboardController],
})
export class OwnerDashboardModule {}
