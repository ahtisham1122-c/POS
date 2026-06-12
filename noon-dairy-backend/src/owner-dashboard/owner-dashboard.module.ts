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
        select: { code: true, name: true, stock: true, lowStockThreshold: true, costPrice: true, unit: true },
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
        where: { isActive: true },
        orderBy: { currentBalance: 'desc' },
        take: 8,
        select: {
          name: true,
          currentBalance: true,
          defaultRate: true,
          cowRate: true,
          buffaloRate: true,
          milkSupplyMode: true,
        },
      }),
    ]);

    const trendRanges = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() - (6 - index));
      return makePakistanRangeFromDate(day);
    });

    const salesTrend = await Promise.all(
      trendRanges.map(async (range) => {
        const [saleAgg, count, refundAgg, milkSold, yogurtSold] = await Promise.all([
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
        ]);
        const gross = money(saleAgg._sum.grandTotal);
        const refundsForDay = money(refundAgg._sum.refundAmount);
        return {
          date: range.date,
          bills: count,
          grossSales: gross,
          refunds: refundsForDay,
          netSales: money(gross - refundsForDay),
          milkKg: quantity(milkSold._sum.quantity),
          yogurtKg: quantity(yogurtSold._sum.quantity),
        };
      }),
    );

    const splitByMethod = splitPayments.reduce<Record<string, number>>((acc, row) => {
      acc[String(row.method).toUpperCase()] = money(row._sum.amount);
      return acc;
    }, {});

    const grossSales = money(salesAgg._sum.grandTotal);
    const refunds = money(realRefundAgg._sum.refundAmount);
    const netSales = money(grossSales - refunds);
    const milkProduct = products.find((p) => p.code === 'MILK');
    const yogurtProduct = products.find((p) => p.code === 'YOGT');
    const lowStockCount = products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.lowStockThreshold)).length;
    const outOfStockCount = products.filter((p) => Number(p.stock) <= 0).length;
    const stockValue = products.reduce((sum, p) => sum + Number(p.stock) * Number(p.costPrice), 0);
    const lowStockProducts = products
      .filter((p) => Number(p.stock) <= 0 || Number(p.stock) <= Number(p.lowStockThreshold))
      .sort((a, b) => Number(a.stock) - Number(b.stock))
      .slice(0, 8);

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
      devices: devices.map((device) => {
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
      }),
      recentSales: recentSales.map((sale) => ({
        billNumber: sale.billNumber,
        saleDate: sale.saleDate.toISOString(),
        paymentType: sale.paymentType,
        grandTotal: money(sale.grandTotal),
        customerName: sale.customer?.name || 'Walk-in',
      })),
      charts: {
        salesTrend,
        paymentMix: [
          { name: 'Cash', value: money(cashSalesAgg._sum.grandTotal) + money(splitByMethod.CASH) },
          { name: 'Online', value: money(onlineSalesAgg._sum.grandTotal) + money(splitByMethod.ONLINE) },
          { name: 'Khata', value: money(khataSalesAgg._sum.grandTotal) + money(splitByMethod.CREDIT) + money(splitByMethod.KHATA) },
        ],
        topProducts: topProducts.map((item) => ({
          name: item.productName,
          unit: item.unit,
          quantity: quantity(item._sum.quantity),
          revenue: money(item._sum.lineTotal),
        })),
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
        })),
      },
    };
  }
}

function ownerDashboardHtml() {
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

@ApiTags('owner-dashboard')
@Controller('owner-dashboard')
export class OwnerDashboardController {
  constructor(private readonly service: OwnerDashboardService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page() {
    return ownerDashboardHtml();
    return `<!doctype html>
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
</html>`;
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
