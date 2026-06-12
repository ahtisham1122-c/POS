import { Controller, Get, Header, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaymentType, Role, SaleStatus } from '@prisma/client';
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

function minutesAgo(date: Date | null | undefined) {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 60000);
}

@Injectable()
export class OwnerDashboardService {
  constructor(private readonly prisma: PrismaService) {}

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
        select: { code: true, name: true, stock: true, lowStockThreshold: true, costPrice: true },
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
    ]);

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
    };
  }
}

@ApiTags('owner-dashboard')
@Controller('owner-dashboard')
export class OwnerDashboardController {
  constructor(private readonly service: OwnerDashboardService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Noon Dairy Owner Dashboard</title>
  <style>
    :root { color-scheme: dark; --bg:#101418; --panel:#171d23; --muted:#94a3b8; --text:#f8fafc; --line:#2b3642; --good:#22c55e; --warn:#f59e0b; --bad:#ef4444; --brand:#38bdf8; }
    * { box-sizing:border-box; } body { margin:0; font-family:Arial, sans-serif; background:var(--bg); color:var(--text); }
    header { padding:18px 16px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:12px; align-items:center; }
    h1 { font-size:18px; margin:0; } .muted { color:var(--muted); font-size:12px; } main { padding:14px; max-width:1100px; margin:0 auto; }
    .login, .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; } .wide { grid-column:span 2; }
    .card b { display:block; font-size:22px; margin-top:6px; } .label { color:var(--muted); font-size:12px; text-transform:uppercase; font-weight:700; }
    input, button { width:100%; height:44px; border-radius:8px; border:1px solid var(--line); background:#0b1015; color:var(--text); padding:0 12px; font-weight:700; }
    button { background:var(--brand); color:#041018; border:0; cursor:pointer; } button.secondary { background:#253241; color:var(--text); }
    .row { display:flex; justify-content:space-between; gap:10px; padding:7px 0; border-bottom:1px solid var(--line); font-size:13px; }
    .row:last-child { border-bottom:0; } .status { font-weight:900; } .online { color:var(--good); } .stale { color:var(--warn); } .offline, .revoked { color:var(--bad); }
    .hidden { display:none; } .error { color:#fecaca; background:#451a1a; border:1px solid #7f1d1d; border-radius:8px; padding:10px; margin-top:10px; }
    @media (max-width:800px){ .grid{grid-template-columns:repeat(2,minmax(0,1fr));}.wide{grid-column:span 2;} header{align-items:flex-start; flex-direction:column;} }
  </style>
</head>
<body>
  <header>
    <div><h1>Noon Dairy Owner Dashboard</h1><div class="muted" id="stamp">Private VPS view</div></div>
    <button class="secondary" style="max-width:150px" onclick="loadSummary()">Refresh</button>
  </header>
  <main>
    <section id="login" class="login">
      <div class="grid">
        <input id="username" placeholder="Username" autocomplete="username" />
        <input id="password" placeholder="Password/PIN" type="password" autocomplete="current-password" />
        <button onclick="login()">Login</button>
      </div>
      <div id="loginError"></div>
    </section>
    <section id="dashboard" class="hidden">
      <div class="grid" id="cards"></div>
      <div class="grid" style="margin-top:10px">
        <div class="card wide"><div class="label">Devices</div><div id="devices"></div></div>
        <div class="card wide"><div class="label">Recent Sales</div><div id="recentSales"></div></div>
      </div>
    </section>
  </main>
  <script>
    let token = localStorage.getItem('ownerAccessToken') || '';
    if (token) { document.getElementById('login').classList.add('hidden'); document.getElementById('dashboard').classList.remove('hidden'); loadSummary(); }
    const money = (n) => 'Rs. ' + Math.round(Number(n || 0)).toLocaleString('en-PK');
    async function login() {
      document.getElementById('loginError').innerHTML = '';
      const res = await fetch('auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username:username.value, password:password.value }) });
      if (!res.ok) { document.getElementById('loginError').innerHTML = '<div class="error">Login failed. Use backend admin/manager login.</div>'; return; }
      const data = await res.json(); token = data.accessToken; localStorage.setItem('ownerAccessToken', token);
      document.getElementById('login').classList.add('hidden'); document.getElementById('dashboard').classList.remove('hidden'); loadSummary();
    }
    async function loadSummary() {
      if (!token) return;
      const res = await fetch('owner-dashboard/summary', { headers:{ Authorization:'Bearer ' + token } });
      if (res.status === 401 || res.status === 403) { localStorage.removeItem('ownerAccessToken'); location.reload(); return; }
      const d = await res.json(); stamp.textContent = 'Date ' + d.date + ' | Updated ' + new Date(d.generatedAt).toLocaleString();
      cards.innerHTML = [
        ['Gross Sales', money(d.sales.grossSales), d.sales.billCount + ' bills'],
        ['Net Sales', money(d.sales.netSales), 'refunds ' + money(d.sales.refunds)],
        ['Expected Cash', money(d.register?.expectedCash), d.register?.isClosed ? 'register closed' : 'register open'],
        ['Online', money(d.sales.onlineSales), 'expected ' + money(d.register?.expectedOnline)],
        ['Khata Due', money(d.khata.totalDue), d.khata.customersOwing + ' customers'],
        ['Milk Bought', d.suppliers.milkKgToday + ' kg', money(d.suppliers.milkPurchaseToday)],
        ['Expenses', money(d.expenses.today), 'today'],
        ['Milk Stock', d.inventory.milkKg + ' kg', 'yogurt ' + d.inventory.yogurtKg + ' kg'],
      ].map(([a,b,c]) => '<div class="card"><div class="label">'+a+'</div><b>'+b+'</b><div class="muted">'+c+'</div></div>').join('');
      devices.innerHTML = (d.devices || []).map(x => '<div class="row"><span>'+x.deviceName+'</span><span class="status '+x.health+'">'+x.health+' '+(x.minutesSinceSeen ?? '-')+'m</span></div>').join('') || '<div class="muted">No devices</div>';
      recentSales.innerHTML = (d.recentSales || []).map(x => '<div class="row"><span>'+x.billNumber+' '+x.paymentType+'</span><b>'+money(x.grandTotal)+'</b></div>').join('') || '<div class="muted">No sales today</div>';
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
}

@Module({
  providers: [OwnerDashboardService],
  controllers: [OwnerDashboardController],
})
export class OwnerDashboardModule {}
