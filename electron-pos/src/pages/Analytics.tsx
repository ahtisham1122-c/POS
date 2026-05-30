import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { format } from "date-fns";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Users,
  Receipt,
  Milk,
  CircleDollarSign,
  Clock,
  Calendar,
  CreditCard,
  Package,
  AlertTriangle,
  Wallet,
  BarChart3,
  Target,
  Sparkles,
  LineChart,
  Activity,
  Gauge,
  ShieldAlert,
  CheckCircle2,
  ArrowUpRight,
  Landmark
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis
} from "recharts";
import { cn } from "../lib/utils";

const CHART_COLORS = {
  milk: "#388bfd",
  yogurt: "#d29922",
  revenue: "#2ea043",
  grid: "#30363d",
  axis: "#8b949e"
};

type TodayKpis = {
  bills: number;
  revenue: number;
  refunds?: number;
  refundCount?: number;
  netSales?: number;
  expenses?: number;
  estimatedGrossProfit?: number;
  estimatedNetProfit?: number;
  marginPct?: number;
  avgBill: number;
  avgMilkKgPerBill: number;
  avgYogurtKgPerBill: number;
  milkKg: number;
  yogurtKg: number;
  combinedKg: number;
};

type HourPoint = { hour: number; bills: number; revenue: number };

type DayPoint = {
  date: string;
  bills: number;
  revenue: number;
  milkKg: number;
  yogurtKg: number;
  combinedKg: number;
};

type PeriodSummary = {
  bills: number;
  revenue: number;
  milkKg: number;
  yogurtKg: number;
  avgBill: number;
  avgMilkKgPerBill: number;
  avgYogurtKgPerBill: number;
};

type Analytics = {
  reportDate?: string;
  daysBack?: number;
  today: TodayKpis;
  hourly: HourPoint[];
  dailyTrend: DayPoint[];
  compare: {
    thisWeek: PeriodSummary;
    lastWeek: PeriodSummary;
    thisMonth: PeriodSummary;
    lastMonth: PeriodSummary;
  };
  yogurtPlan?: {
    targetDate: string;
    recommendedKg: number;
    confidence: "LOW" | "MEDIUM" | "HIGH";
    recent7AvgKg: number;
    recentActiveAvgKg: number;
    sameWeekdayAvgKg: number;
    sameWeekdayMedianKg?: number;
    ewmaKg?: number;
    todayYogurtKg: number;
    safetyBufferPct: number;
    basisDays: number;
    sameWeekdaySamples: number;
    weekTrend?: "rising" | "falling" | "steady";
    weekTrendPct?: number;
    volatilityPct?: number;
    knownSharePct?: number;
    expectedRangeKg?: { low: number; high: number };
    sameWeekdayHistory?: Array<{ date: string; yogurtKg: number }>;
    factors?: {
      seasonalKg: number;
      ewmaKg: number;
      todayKg: number;
      trendFactor: number;
      mixFactor: number;
    };
  };
  customerBehavior?: {
    totalBills: number;
    walkInBills: number;
    knownBills: number;
    knownCustomers: number;
    walkInRevenue: number;
    knownRevenue: number;
    repeatCustomers: Array<{ id: string; name: string; phone?: string; visits: number; revenue: number; lastVisit: string }>;
  };
  busiestHour?: HourPoint | null;
  quietestHour?: HourPoint | null;
  tenderMix?: Array<{ method: string; amount: number; bills: number; pct: number }>;
  topProducts?: Array<{ productName: string; unit: string; category: string; quantity: number; revenue: number; grossProfit: number; marginPct: number; bills: number }>;
  categoryMix?: Array<{ category: string; revenue: number; quantity: number; bills: number }>;
  expenseBreakdown?: Array<{ category: string; amount: number; count: number }>;
  customerRisk?: { customersWithDues: number; totalDues: number; overLimitCount: number; topDues: any[] };
  buyPatterns?: {
    milk: BuyPattern;
    yogurt: BuyPattern;
  };
  milkYogurtMix?: {
    windowDays: number;
    bills: { onlyMilk: number; onlyYogurt: number; both: number; neither: number; total: number };
    knownCustomers: { onlyMilk: number; onlyYogurt: number; both: number; total: number };
  };
  sameDayLastYear?: {
    date: string;
    bills: number;
    revenue: number;
    milkKg: number;
    yogurtKg: number;
    revenueDeltaPct: number | null;
    billsDeltaPct: number | null;
    window: { start: string; end: string; bills: number; revenue: number };
  } | null;
  milkCost?: MilkCost;
  stockRisk?: any[];
  insights?: string[];
  generatedAt: string;
};

type BuyPattern = {
  totalBillsWithItem: number;
  mostCommonQty: number;
  mostCommonSharePct: number;
  top: Array<{ qty: number; bills: number; revenue: number; sharePct: number }>;
};

type MilkCost = {
  today: {
    date: string;
    totalKg: number;
    totalSpend: number;
    avgRatePerKg: number;
    supplierCount: number;
    entryCount: number;
    minRate: number;
    maxRate: number;
    cow: { kg: number; spend: number; avgRate: number };
    buffalo: { kg: number; spend: number; avgRate: number };
    mixed: { kg: number; spend: number; avgRate: number };
    cheapestSupplier: { name: string; rate: number; milkType: string; shift: string } | null;
    priciestSupplier: { name: string; rate: number; milkType: string; shift: string } | null;
  };
  window: {
    days: number;
    totalKg: number;
    totalSpend: number;
    avgRatePerKg: number;
  };
  selling: {
    milkRate: number;
    marginPerKg: number;
    marginPct: number;
  };
  dailyTrend: Array<{ date: string; avgRatePerKg: number; totalKg: number }>;
};

type TopProductInsight = NonNullable<Analytics["topProducts"]>[number];
type ExpenseInsight = NonNullable<Analytics["expenseBreakdown"]>[number];

function todayLocalIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Daily-volume chart axis helpers — keep labels short so 30+ bars fit on
// screen without truncation, and avoid timezone drift by parsing the ISO
// date as local midnight (not UTC).
function formatChartDate(iso: string) {
  return format(new Date(`${iso}T00:00:00`), "EEE, dd MMM yyyy");
}
function formatChartDateShort(iso: string) {
  return format(new Date(`${iso}T00:00:00`), "dd MMM");
}

function rs(n: number) {
  return `Rs. ${Math.round(Number(n || 0)).toLocaleString("en-PK")}`;
}

function kg(n: number) {
  return `${Number(n || 0).toFixed(2)} kg`;
}

// Per-bill averages need extra decimals — owners care about 0.05 kg shifts.
function avgKg(n: number) {
  return `${Number(n || 0).toFixed(3)} kg`;
}

function deltaPct(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function pct(n: number) {
  return `${Number(n || 0).toFixed(1)}%`;
}

export default function Analytics() {
  const [data, setData] = useState<Analytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Date picker for reviewing historical days. Defaults to today (local).
  const [pickedDate, setPickedDate] = useState<string>(todayLocalIso());
  const [daysBack, setDaysBack] = useState<number>(30);
  const isToday = pickedDate === todayLocalIso();

  async function loadData(date = pickedDate, span = daysBack) {
    setIsLoading(true);
    try {
      const result = await window.electronAPI?.reports?.getAnalytics({ date, daysBack: span });
      setData(result || null);
    } catch (err) {
      console.error("Analytics load failed", err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData(pickedDate, daysBack);
    // Only auto-refresh when viewing today — for past dates the data is
    // historical and never changes, so polling would be wasteful.
    if (!isToday) return;
    const id = setInterval(() => loadData(pickedDate, daysBack), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedDate, daysBack]);

  if (isLoading && !data) {
    return (
      <div className="p-6 flex justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-text-secondary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-center text-text-secondary">
        No analytics data yet. Make some sales first.
      </div>
    );
  }

  const {
    today,
    hourly,
    dailyTrend,
    compare,
    tenderMix = [],
    topProducts = [],
    categoryMix = [],
    expenseBreakdown = [],
    customerRisk,
    stockRisk = [],
    insights = [],
    busiestHour,
    quietestHour,
    yogurtPlan,
    customerBehavior,
    buyPatterns,
    milkYogurtMix,
    sameDayLastYear,
    milkCost
  } = data;
  const activeDays = dailyTrend.filter((day) => day.bills > 0);
  const windowRevenue = dailyTrend.reduce((sum, day) => sum + Number(day.revenue || 0), 0);
  const windowBills = dailyTrend.reduce((sum, day) => sum + Number(day.bills || 0), 0);
  const windowMilkKg = dailyTrend.reduce((sum, day) => sum + Number(day.milkKg || 0), 0);
  const windowYogurtKg = dailyTrend.reduce((sum, day) => sum + Number(day.yogurtKg || 0), 0);
  const avgActiveDayRevenue = activeDays.length ? windowRevenue / activeDays.length : 0;
  const avgWindowBill = windowBills > 0 ? windowRevenue / windowBills : 0;
  const bestDay = activeDays.reduce((best, row) => !best || row.revenue > best.revenue ? row : best, null as DayPoint | null);
  const softDay = activeDays.reduce((best, row) => !best || row.revenue < best.revenue ? row : best, null as DayPoint | null);
  const cashTender = tenderMix.find((row) => row.method === "CASH");
  const onlineTender = tenderMix.find((row) => row.method === "ONLINE");
  const khataTender = tenderMix.find((row) => row.method === "KHATA");
  const tenderTotal = tenderMix.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const refundRate = today.revenue > 0 ? (Number(today.refunds || 0) / today.revenue) * 100 : 0;
  const expenseRate = (today.netSales || today.revenue) > 0 ? (Number(today.expenses || 0) / Number(today.netSales || today.revenue)) * 100 : 0;
  const topProduct = topProducts[0];
  const biggestExpense = expenseBreakdown[0];
  const duesToRevenueDays = avgActiveDayRevenue > 0 ? Number(customerRisk?.totalDues || 0) / avgActiveDayRevenue : 0;
  const lowStockCount = stockRisk.length;
  const healthSignals = [
    { ok: Number(today.marginPct || 0) >= 15, label: "Profit margin" },
    { ok: refundRate <= 3, label: "Refund control" },
    { ok: lowStockCount === 0, label: "Stock position" },
    { ok: Number(customerRisk?.overLimitCount || 0) === 0, label: "Khata discipline" },
    { ok: today.bills > 0, label: "Trading activity" }
  ];
  const healthScore = Math.round((healthSignals.filter((item) => item.ok).length / healthSignals.length) * 100);
  const actions = [
    lowStockCount > 0 ? `Restock ${lowStockCount} low-stock item${lowStockCount === 1 ? "" : "s"} before peak hours.` : "Stock position is clean for the current low-stock rules.",
    Number(customerRisk?.overLimitCount || 0) > 0
      ? `Collect or review ${customerRisk?.overLimitCount} khata account${Number(customerRisk?.overLimitCount || 0) === 1 ? "" : "s"} over limit.`
      : "No customer is over credit limit.",
    biggestExpense ? `Review ${biggestExpense.category.toLowerCase()} expense: ${rs(biggestExpense.amount)} in this window.` : "No expense pressure found in this window.",
    busiestHour ? `Keep strongest staff ready around ${formatHour(busiestHour.hour)}.` : "Peak staffing hour will appear after sales are recorded."
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
            Analytics
            {isToday ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 border border-success/20">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
                <span className="text-[10px] font-bold text-success uppercase tracking-wider">Live</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-warning/10 border border-warning/20">
                <span className="text-[10px] font-bold text-warning uppercase tracking-wider">History</span>
              </div>
            )}
          </h1>
          <p className="text-text-secondary mt-1">
            {isToday
              ? `Walk-in trends. Refreshes every 30 seconds. Last updated ${format(new Date(data.generatedAt), "hh:mm a")}.`
              : `Showing data for ${format(new Date(`${pickedDate}T00:00:00`), "EEEE, dd MMM yyyy")}.`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-surface-2/40 border border-surface-4 rounded-lg px-3 py-1.5">
            <Calendar className="w-4 h-4 text-text-secondary" />
            <input
              type="date"
              value={pickedDate}
              max={todayLocalIso()}
              onChange={(e) => setPickedDate(e.target.value || todayLocalIso())}
              className="bg-transparent text-sm font-mono outline-none text-text-primary"
            />
            {!isToday && (
              <button
                onClick={() => setPickedDate(todayLocalIso())}
                className="text-[10px] font-bold uppercase tracking-wider text-info hover:underline"
                title="Jump back to today"
              >
                Today
              </button>
            )}
          </div>
          <select
            value={daysBack}
            onChange={(e) => setDaysBack(Number(e.target.value) || 30)}
            className="input h-9 text-xs px-2 py-1"
            title="Daily-volume chart window"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={() => loadData(pickedDate, daysBack)}
            className="btn-secondary flex items-center justify-center gap-2"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      <BusinessCommandDashboard
        healthScore={healthScore}
        healthSignals={healthSignals}
        today={today}
        daysBack={daysBack}
        windowRevenue={windowRevenue}
        windowBills={windowBills}
        windowMilkKg={windowMilkKg}
        windowYogurtKg={windowYogurtKg}
        avgActiveDayRevenue={avgActiveDayRevenue}
        avgWindowBill={avgWindowBill}
        bestDay={bestDay}
        softDay={softDay}
        cashTender={cashTender}
        onlineTender={onlineTender}
        khataTender={khataTender}
        tenderTotal={tenderTotal}
        refundRate={refundRate}
        expenseRate={expenseRate}
        topProduct={topProduct}
        biggestExpense={biggestExpense}
        customerRisk={customerRisk}
        duesToRevenueDays={duesToRevenueDays}
        stockRisk={stockRisk}
        busiestHour={busiestHour}
        quietestHour={quietestHour}
        milkCost={milkCost}
        actions={actions}
      />

      {/* ---------- TODAY/HISTORICAL KPI CARDS ---------- */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-text-secondary mb-3">
          {isToday ? "Today" : format(new Date(`${pickedDate}T00:00:00`), "EEEE, dd MMM yyyy")}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard
            icon={<Users className="w-5 h-5" />}
            label="Customers Served"
            value={today.bills.toLocaleString("en-PK")}
            tone="primary"
          />
          <KpiCard
            icon={<CircleDollarSign className="w-5 h-5" />}
            label="Total Sales"
            value={rs(today.revenue)}
            tone="success"
          />
          <KpiCard
            icon={<Receipt className="w-5 h-5" />}
            label="Avg Bill"
            value={rs(today.avgBill)}
          />
          <KpiCard
            icon={<Milk className="w-5 h-5" />}
            label="Avg Milk / Customer"
            value={avgKg(today.avgMilkKgPerBill)}
            tone="info"
          />
          <KpiCard
            icon={<Milk className="w-5 h-5" />}
            label="Avg Yogurt / Customer"
            value={avgKg(today.avgYogurtKgPerBill)}
            tone="info"
          />
          <KpiCard
            icon={<Milk className="w-5 h-5" />}
            label="Combined Milk + Yogurt"
            value={kg(today.combinedKg)}
            tone="warning"
          />
        </div>
      </section>

      {/* ---------- OWNER COMMAND CENTER ---------- */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-text-secondary mb-3">
          Owner Command Center
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            icon={<Wallet className="w-5 h-5" />}
            label="Net Sales"
            value={rs(today.netSales ?? today.revenue)}
            tone="success"
          />
          <KpiCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Est. Gross Profit"
            value={rs(today.estimatedGrossProfit || 0)}
            tone="primary"
          />
          <KpiCard
            icon={<TrendingDown className="w-5 h-5" />}
            label="Refunds"
            value={rs(today.refunds || 0)}
            tone="warning"
          />
          <KpiCard
            icon={<BarChart3 className="w-5 h-5" />}
            label="Est. Margin"
            value={`${Number(today.marginPct || 0).toFixed(1)}%`}
            tone="info"
          />
        </div>
      </section>

      <section className="grid xl:grid-cols-3 gap-4">
        <YogurtPlanCard plan={yogurtPlan} />
        <CustomerBehaviorCard behavior={customerBehavior} />
        <div className="card p-5 overflow-hidden">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                <LineChart className="w-5 h-5 text-success" /> Revenue Pulse
              </h2>
              <p className="text-xs text-text-secondary mt-1">Last {daysBack} days, anchored to selected date.</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-text-secondary">Best Day</p>
              <p className="font-mono font-bold text-success">{rs(Math.max(0, ...dailyTrend.map((d) => d.revenue)))}</p>
            </div>
          </div>
          <RevenuePulseChart dailyTrend={dailyTrend} />
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-surface-2/60 border border-surface-4 p-2">
              <p className="text-text-secondary">Milk</p>
              <p className="font-mono font-bold text-info">{kg(dailyTrend.reduce((s, d) => s + d.milkKg, 0))}</p>
            </div>
            <div className="rounded-lg bg-surface-2/60 border border-surface-4 p-2">
              <p className="text-text-secondary">Yogurt</p>
              <p className="font-mono font-bold text-warning">{kg(dailyTrend.reduce((s, d) => s + d.yogurtKg, 0))}</p>
            </div>
            <div className="rounded-lg bg-surface-2/60 border border-surface-4 p-2">
              <p className="text-text-secondary">Bills</p>
              <p className="font-mono font-bold">{dailyTrend.reduce((s, d) => s + d.bills, 0)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- BUY PATTERNS, MIX, SAME-DAY-LAST-YEAR ---------- */}
      <section className="grid xl:grid-cols-3 gap-4">
        <BuyPatternCard
          title="Milk Buying Pattern"
          subtitle="Most common kg sizes customers ask for"
          accent={CHART_COLORS.milk}
          pattern={buyPatterns?.milk}
        />
        <BuyPatternCard
          title="Yogurt Buying Pattern"
          subtitle="Most common kg sizes customers ask for"
          accent={CHART_COLORS.yogurt}
          pattern={buyPatterns?.yogurt}
        />
        <MilkYogurtMixCard mix={milkYogurtMix} />
      </section>

      <section className="grid xl:grid-cols-2 gap-4">
        <MilkCostCard milkCost={milkCost} isToday={isToday} />
        <SameDayLastYearCard sameDay={sameDayLastYear ?? null} todayKpis={today} pickedDate={pickedDate} />
      </section>

      {/* ---------- HOURLY BREAKDOWN ---------- */}
      <section className="card overflow-hidden">
        <div className="p-5 border-b border-surface-4 bg-surface-2/70">
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <Clock className="w-5 h-5 text-info" />
            {isToday ? "Hourly Customers Today" : `Hourly Customers — ${format(new Date(`${pickedDate}T00:00:00`), "dd MMM yyyy")}`}
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Bar height = number of bills served in that hour (your shop's local time).
          </p>
        </div>
        <div className="p-5">
          <HourlyCustomersChart hourly={hourly} />
        </div>
      </section>

      <section className="grid xl:grid-cols-3 gap-4">
        <div className="card p-5 xl:col-span-1">
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-info" /> Payment Mix
          </h2>
          {tenderMix.length === 0 ? (
            <p className="text-sm text-text-secondary">No payments yet.</p>
          ) : (
            <>
              <DonutChart
                data={tenderMix.map((row) => ({ name: row.method, value: Number(row.amount || 0) }))}
                total={tenderMix.reduce((sum, row) => sum + Number(row.amount || 0), 0)}
                centerLabel="Total"
                centerValue={rs(tenderMix.reduce((sum, row) => sum + Number(row.amount || 0), 0))}
              />
              <div className="mt-4">
                <DonutLegend
                  rows={tenderMix.map((row) => ({
                    name: row.method,
                    value: rs(row.amount),
                    sub: `${row.bills} bill${row.bills === 1 ? "" : "s"} · ${Number(row.pct || 0).toFixed(1)}%`
                  }))}
                />
              </div>
            </>
          )}
        </div>

        <div className="card p-5 xl:col-span-2">
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-success" /> Product Winners
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-secondary border-b border-surface-4">
                  <th className="py-2 font-semibold">Product</th>
                  <th className="py-2 text-right font-semibold">Qty</th>
                  <th className="py-2 text-right font-semibold">Revenue</th>
                  <th className="py-2 text-right font-semibold">Est. Profit</th>
                  <th className="py-2 text-right font-semibold">Margin</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.slice(0, 8).map((row) => (
                  <tr key={`${row.productName}-${row.unit}`} className="border-b border-surface-4 last:border-0">
                    <td className="py-2">
                      <div className="font-semibold text-text-primary">{row.productName}</div>
                      <div className="text-xs text-text-secondary">{row.category}</div>
                    </td>
                    <td className="py-2 text-right font-mono">{Number(row.quantity || 0).toFixed(2)} {row.unit}</td>
                    <td className="py-2 text-right font-mono">{rs(row.revenue)}</td>
                    <td className="py-2 text-right font-mono text-success">{rs(row.grossProfit)}</td>
                    <td className="py-2 text-right font-mono">{Number(row.marginPct || 0).toFixed(1)}%</td>
                  </tr>
                ))}
                {topProducts.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-text-secondary">No product sales yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- DAILY TREND ---------- */}
      <section className="card overflow-hidden">
        <div className="p-5 border-b border-surface-4 bg-surface-2/70">
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <Calendar className="w-5 h-5 text-success" /> Daily Volume — Last {daysBack} Days
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Combined milk + yogurt (kg). Days with no sales show as empty bars
            so you can clearly see where the gaps are.
          </p>
        </div>
        <div className="p-5">
          <DailyVolumeChart dailyTrend={dailyTrend} />
          <div className="mt-4 flex items-center gap-5 text-xs text-text-secondary flex-wrap">
            <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: CHART_COLORS.milk }} /> Milk kg</span>
            <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: CHART_COLORS.yogurt }} /> Yogurt kg</span>
            <span className="inline-flex items-center gap-2"><span className="w-3 h-1 rounded-sm" style={{ background: CHART_COLORS.revenue }} /> Revenue (Rs.)</span>
          </div>
        </div>
      </section>

      {/* ---------- COMPARISON ---------- */}
      <section className="grid md:grid-cols-2 gap-4">
        <CompareCard
          title="This Week vs Last Week"
          current={compare.thisWeek}
          previous={compare.lastWeek}
        />
        <CompareCard
          title="Last 30 Days vs Previous 30 Days"
          current={compare.thisMonth}
          previous={compare.lastMonth}
        />
      </section>

      <section className="grid lg:grid-cols-3 gap-4">
        <InsightPanel title="Business Insights" icon={<BarChart3 className="w-5 h-5 text-primary" />}>
          {insights.map((item, index) => (
            <li key={index} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>{item}</span>
            </li>
          ))}
          {busiestHour && (
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-success shrink-0" />
              <span>Best staffing time: {formatHour(busiestHour.hour)}.</span>
            </li>
          )}
          {quietestHour && (
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
              <span>Slowest active hour: {formatHour(quietestHour.hour)}.</span>
            </li>
          )}
        </InsightPanel>

        <InsightPanel title="Khata Risk" icon={<Users className="w-5 h-5 text-warning" />}>
          <li>Total dues: <strong>{rs(customerRisk?.totalDues || 0)}</strong></li>
          <li>Customers owing: <strong>{customerRisk?.customersWithDues || 0}</strong></li>
          <li>Over limit: <strong>{customerRisk?.overLimitCount || 0}</strong></li>
          {(customerRisk?.topDues || []).slice(0, 4).map((c: any) => (
            <li key={c.id} className="flex justify-between gap-3">
              <span className="truncate">{c.name}</span>
              <strong>{rs(c.current_balance)}</strong>
            </li>
          ))}
        </InsightPanel>

        <InsightPanel title="Risk Monitor" icon={<AlertTriangle className="w-5 h-5 text-danger" />}>
          <li>Low-stock items: <strong>{stockRisk.length}</strong></li>
          {stockRisk.slice(0, 5).map((p: any) => (
            <li key={p.id} className="flex justify-between gap-3">
              <span className="truncate">{p.name}</span>
              <strong>{Number(p.stock || 0).toFixed(2)} {p.unit}</strong>
            </li>
          ))}
          {expenseBreakdown.length > 0 && (
            <li className="pt-2 border-t border-surface-4">
              Biggest expense: <strong>{expenseBreakdown[0].category}</strong> {rs(expenseBreakdown[0].amount)}
            </li>
          )}
        </InsightPanel>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold text-text-primary mb-4">Category Mix</h2>
        {categoryMix.length === 0 ? (
          <p className="text-sm text-text-secondary">No category sales yet.</p>
        ) : (
          <div className="grid lg:grid-cols-3 gap-5">
            <div className="lg:col-span-1">
              <DonutChart
                data={categoryMix.map((row) => ({ name: row.category, value: Number(row.revenue || 0) }))}
                total={categoryMix.reduce((sum, item) => sum + Number(item.revenue || 0), 0)}
                centerLabel="Revenue"
                centerValue={rs(categoryMix.reduce((sum, item) => sum + Number(item.revenue || 0), 0))}
              />
              <div className="mt-4">
                <DonutLegend
                  rows={categoryMix.map((row) => {
                    const total = categoryMix.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
                    const pct = total > 0 ? (Number(row.revenue || 0) / total) * 100 : 0;
                    return { name: row.category, value: rs(row.revenue), sub: `${pct.toFixed(1)}%` };
                  })}
                />
              </div>
            </div>
            <div className="lg:col-span-2 grid sm:grid-cols-2 gap-3 content-start">
              {categoryMix.map((row) => {
                const total = categoryMix.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
                const pct = total > 0 ? (Number(row.revenue || 0) / total) * 100 : 0;
                return (
                  <div key={row.category} className="rounded-lg border border-surface-4 bg-surface-2/40 p-4">
                    <div className="flex justify-between gap-3">
                      <span className="font-bold text-text-primary">{row.category}</span>
                      <span className="font-mono text-success">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="mt-2 text-2xl font-bold">{rs(row.revenue)}</div>
                    <div className="mt-1 text-xs text-text-secondary">{Number(row.quantity || 0).toFixed(2)} units/kg across {row.bills} bills</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function BusinessCommandDashboard({
  healthScore,
  healthSignals,
  today,
  daysBack,
  windowRevenue,
  windowBills,
  windowMilkKg,
  windowYogurtKg,
  avgActiveDayRevenue,
  avgWindowBill,
  bestDay,
  softDay,
  cashTender,
  onlineTender,
  khataTender,
  tenderTotal,
  refundRate,
  expenseRate,
  topProduct,
  biggestExpense,
  customerRisk,
  duesToRevenueDays,
  stockRisk,
  busiestHour,
  quietestHour,
  milkCost,
  actions
}: {
  healthScore: number;
  healthSignals: Array<{ ok: boolean; label: string }>;
  today: TodayKpis;
  daysBack: number;
  windowRevenue: number;
  windowBills: number;
  windowMilkKg: number;
  windowYogurtKg: number;
  avgActiveDayRevenue: number;
  avgWindowBill: number;
  bestDay: DayPoint | null;
  softDay: DayPoint | null;
  cashTender?: { method: string; amount: number; bills: number; pct: number };
  onlineTender?: { method: string; amount: number; bills: number; pct: number };
  khataTender?: { method: string; amount: number; bills: number; pct: number };
  tenderTotal: number;
  refundRate: number;
  expenseRate: number;
  topProduct?: TopProductInsight;
  biggestExpense?: ExpenseInsight;
  customerRisk?: Analytics["customerRisk"];
  duesToRevenueDays: number;
  stockRisk: any[];
  busiestHour?: HourPoint | null;
  quietestHour?: HourPoint | null;
  milkCost?: MilkCost;
  actions: string[];
}) {
  const healthTone =
    healthScore >= 80 ? "text-success border-success/30 bg-success/5"
    : healthScore >= 55 ? "text-warning border-warning/30 bg-warning/5"
    : "text-danger border-danger/30 bg-danger/5";
  const netSales = Number(today.netSales ?? today.revenue);
  const grossProfit = Number(today.estimatedGrossProfit || 0);
  const netProfit = Number(today.estimatedNetProfit || 0);
  const cashPct = tenderTotal > 0 ? (Number(cashTender?.amount || 0) / tenderTotal) * 100 : 0;
  const onlinePct = tenderTotal > 0 ? (Number(onlineTender?.amount || 0) / tenderTotal) * 100 : 0;
  const khataPct = tenderTotal > 0 ? (Number(khataTender?.amount || 0) / tenderTotal) * 100 : 0;

  return (
    <section className="grid xl:grid-cols-12 gap-4">
      <div className="card p-5 xl:col-span-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <Gauge className="w-5 h-5 text-primary" /> Business Health
            </h2>
            <p className="text-xs text-text-secondary mt-1">Trading, profit, stock, and khata signals.</p>
          </div>
          <span className={cn("text-sm font-black px-3 py-1 rounded-full border", healthTone)}>
            {healthScore}/100
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <CommandMetric label="Net sales" value={rs(netSales)} sub={`${today.bills.toLocaleString("en-PK")} bills`} tone="success" />
          <CommandMetric label="Net profit" value={rs(netProfit)} sub={`${pct(today.marginPct || 0)} gross margin`} tone={netProfit >= 0 ? "primary" : "danger"} />
          <CommandMetric label={`${daysBack}d sales`} value={rs(windowRevenue)} sub={`${windowBills.toLocaleString("en-PK")} bills`} tone="info" />
          <CommandMetric label="Avg active day" value={rs(avgActiveDayRevenue)} sub={`Avg bill ${rs(avgWindowBill)}`} />
        </div>

        <div className="mt-4 grid grid-cols-5 gap-1">
          {healthSignals.map((signal) => (
            <div
              key={signal.label}
              className={cn(
                "h-2 rounded-full",
                signal.ok ? "bg-success" : "bg-danger/70"
              )}
              title={`${signal.label}: ${signal.ok ? "OK" : "Needs attention"}`}
            />
          ))}
        </div>
      </div>

      <div className="card p-5 xl:col-span-4">
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <Landmark className="w-5 h-5 text-success" /> Money Quality
        </h2>
        <p className="text-xs text-text-secondary mt-1">Cash, online, khata, refunds, and expenses.</p>

        <div className="mt-5 space-y-3">
          <MoneyMixBar label="Cash" value={cashPct} amount={cashTender?.amount || 0} color="#2ea043" />
          <MoneyMixBar label="Online" value={onlinePct} amount={onlineTender?.amount || 0} color="#388bfd" />
          <MoneyMixBar label="Khata" value={khataPct} amount={khataTender?.amount || 0} color="#d29922" />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <MiniStat label="Refund rate" value={pct(refundRate)} sub={rs(today.refunds || 0)} />
          <MiniStat label="Expense rate" value={pct(expenseRate)} sub={rs(today.expenses || 0)} />
          <MiniStat label="Gross profit" value={rs(grossProfit)} sub={pct(today.marginPct || 0)} />
        </div>
      </div>

      <div className="card p-5 xl:col-span-4">
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-warning" /> Owner Actions
        </h2>
        <p className="text-xs text-text-secondary mt-1">Highest-value decisions from the selected data.</p>
        <div className="mt-4 space-y-3">
          {actions.map((action, index) => (
            <div key={action} className="flex gap-3 text-sm">
              <CheckCircle2 className={cn("w-4 h-4 mt-0.5 shrink-0", index === 0 ? "text-warning" : "text-success")} />
              <span className="text-text-primary">{action}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5 xl:col-span-12">
        <div className="grid md:grid-cols-2 xl:grid-cols-6 gap-3">
          <InsightTile
            icon={<ArrowUpRight className="w-4 h-4" />}
            label="Best Day"
            value={bestDay ? rs(bestDay.revenue) : "No sales"}
            sub={bestDay ? formatChartDateShort(bestDay.date) : "window"}
            tone="success"
          />
          <InsightTile
            icon={<Activity className="w-4 h-4" />}
            label="Softest Active Day"
            value={softDay ? rs(softDay.revenue) : "No sales"}
            sub={softDay ? formatChartDateShort(softDay.date) : "window"}
            tone="warning"
          />
          <InsightTile
            icon={<Clock className="w-4 h-4" />}
            label="Peak Hour"
            value={busiestHour ? formatHour(busiestHour.hour) : "Pending"}
            sub={busiestHour ? `${busiestHour.bills} bills` : "after sales"}
            tone="info"
          />
          <InsightTile
            icon={<Package className="w-4 h-4" />}
            label="Top Product"
            value={topProduct?.productName || "Pending"}
            sub={topProduct ? `${rs(topProduct.revenue)} sales` : "after sales"}
            tone="primary"
          />
          <InsightTile
            icon={<Users className="w-4 h-4" />}
            label="Khata Exposure"
            value={rs(customerRisk?.totalDues || 0)}
            sub={duesToRevenueDays > 0 ? `${duesToRevenueDays.toFixed(1)} active sales days` : `${customerRisk?.customersWithDues || 0} customers`}
            tone={Number(customerRisk?.overLimitCount || 0) > 0 ? "danger" : "warning"}
          />
          <InsightTile
            icon={<Milk className="w-4 h-4" />}
            label="Milk Cost"
            value={milkCost?.today.avgRatePerKg ? `Rs. ${milkCost.today.avgRatePerKg.toFixed(2)}` : "No entry"}
            sub={milkCost?.today.totalKg ? `${kg(milkCost.today.totalKg)} in` : `${kg(windowMilkKg + windowYogurtKg)} sold`}
            tone="info"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-secondary">
          <span className="rounded-full border border-surface-4 px-2 py-1">Window volume: {kg(windowMilkKg)} milk, {kg(windowYogurtKg)} yogurt</span>
          {quietestHour && <span className="rounded-full border border-surface-4 px-2 py-1">Quiet active hour: {formatHour(quietestHour.hour)}</span>}
          {biggestExpense && <span className="rounded-full border border-surface-4 px-2 py-1">Biggest expense: {biggestExpense.category} {rs(biggestExpense.amount)}</span>}
          {stockRisk.length > 0 && <span className="rounded-full border border-danger/30 text-danger px-2 py-1">Stock alerts: {stockRisk.length}</span>}
        </div>
      </div>
    </section>
  );
}

function CommandMetric({
  label,
  value,
  sub,
  tone = "neutral"
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "success" | "primary" | "info" | "danger";
}) {
  const toneClass =
    tone === "success" ? "text-success"
    : tone === "primary" ? "text-primary"
    : tone === "info" ? "text-info"
    : tone === "danger" ? "text-danger"
    : "text-text-primary";
  return (
    <div className="rounded-lg border border-surface-4 bg-surface-2/50 p-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wider font-bold text-text-secondary truncate">{label}</p>
      <p className={cn("mt-1 font-mono font-black text-lg truncate", toneClass)} title={value}>{value}</p>
      <p className="text-[11px] text-text-secondary truncate" title={sub}>{sub}</p>
    </div>
  );
}

function MoneyMixBar({ label, value, amount, color }: { label: string; value: number; amount: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-bold text-text-primary">{label}</span>
        <span className="font-mono text-text-secondary">{rs(amount)} · {pct(value)}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-surface-3 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
    </div>
  );
}

function InsightTile({
  icon,
  label,
  value,
  sub,
  tone = "neutral"
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "success" | "warning" | "info" | "primary" | "danger";
}) {
  const toneClass =
    tone === "success" ? "text-success bg-success/10"
    : tone === "warning" ? "text-warning bg-warning/10"
    : tone === "info" ? "text-info bg-info/10"
    : tone === "primary" ? "text-primary bg-primary/10"
    : tone === "danger" ? "text-danger bg-danger/10"
    : "text-text-secondary bg-surface-3";
  return (
    <div className="rounded-lg border border-surface-4 bg-surface-2/40 p-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", toneClass)}>{icon}</span>
        <p className="text-[10px] uppercase tracking-wider font-bold text-text-secondary truncate">{label}</p>
      </div>
      <p className="mt-2 font-mono font-black text-text-primary truncate" title={value}>{value}</p>
      <p className="text-[11px] text-text-secondary truncate" title={sub}>{sub}</p>
    </div>
  );
}

function YogurtPlanCard({ plan }: { plan?: Analytics["yogurtPlan"] }) {
  const confidenceTone =
    plan?.confidence === "HIGH" ? "text-success"
    : plan?.confidence === "MEDIUM" ? "text-warning"
    : "text-danger";
  const trend = plan?.weekTrend ?? "steady";
  const trendPct = plan?.weekTrendPct ?? 0;
  const trendTone = trend === "rising" ? "text-success" : trend === "falling" ? "text-danger" : "text-text-secondary";
  const TrendIcon = trend === "rising" ? TrendingUp : trend === "falling" ? TrendingDown : BarChart3;
  const range = plan?.expectedRangeKg;
  const history = plan?.sameWeekdayHistory ?? [];
  return (
    <div className="card p-5 overflow-hidden relative">
      <div className="absolute right-4 top-4 opacity-10">
        <Target className="w-24 h-24" />
      </div>
      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-warning" /> Tomorrow Yogurt Plan
            </h2>
            <p className="text-xs text-text-secondary mt-1">
              Set today's milk aside for tomorrow. Recommendation blends weekday
              history, recent trend, today-so-far, and customer mix.
            </p>
          </div>
          <span className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 px-2 py-0.5 rounded-full border", trendTone, "border-current/30")}>
            <TrendIcon className="w-3 h-3" />
            {trend === "steady" ? "Steady" : `${trendPct > 0 ? "+" : ""}${trendPct.toFixed(1)}% w/w`}
          </span>
        </div>

        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            {plan?.targetDate ? format(new Date(`${plan.targetDate}T00:00:00`), "EEEE, dd MMM") : "Next day"}
          </p>
          <p className="text-4xl font-black text-warning mt-1">{kg(plan?.recommendedKg || 0)}</p>
          <p className={cn("text-xs font-bold mt-1", confidenceTone)}>
            {plan?.confidence || "LOW"} confidence · {plan?.sameWeekdaySamples || 0} same-weekday samples · {plan?.basisDays || 0} days checked
          </p>
          {range && (
            <p className="text-[11px] text-text-secondary mt-1 font-mono">
              Likely range: {kg(range.low)} — {kg(range.high)}
              {plan?.volatilityPct ? <> · vol {plan.volatilityPct.toFixed(0)}%</> : null}
            </p>
          )}
        </div>

        {history.length > 1 && (
          <div className="mt-4">
            <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold mb-1">
              Same weekday history
            </p>
            <div className="h-14">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="yogurtPlanFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.yogurt} stopOpacity={0.55} />
                      <stop offset="100%" stopColor={CHART_COLORS.yogurt} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <ReTooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload || !payload.length) return null;
                      const row = payload[0].payload as { date: string; yogurtKg: number };
                      return (
                        <div className="rounded border border-surface-4 bg-surface-1/95 px-2 py-1 text-[11px] font-mono">
                          <div className="text-text-primary font-bold">{formatChartDateShort(row.date)}</div>
                          <div style={{ color: CHART_COLORS.yogurt }}>{kg(row.yogurtKg)}</div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="yogurtKg"
                    stroke={CHART_COLORS.yogurt}
                    strokeWidth={2}
                    fill="url(#yogurtPlanFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
          <MiniStat label="Same-day" value={kg(plan?.sameWeekdayMedianKg ?? plan?.sameWeekdayAvgKg ?? 0)} sub="median" />
          <MiniStat label="EWMA" value={kg(plan?.ewmaKg ?? 0)} sub="recent" />
          <MiniStat label="Today" value={kg(plan?.todayYogurtKg ?? 0)} sub="so far" />
          <MiniStat label="Buffer" value={`${plan?.safetyBufferPct ?? 0}%`} sub="safety" />
        </div>
        {plan?.knownSharePct != null && (
          <p className="mt-3 text-[11px] text-text-secondary">
            Khata share {plan.knownSharePct.toFixed(0)}% · trend ×{plan.factors?.trendFactor.toFixed(2) ?? "1.00"} · mix ×{plan.factors?.mixFactor.toFixed(2) ?? "1.00"}
          </p>
        )}
      </div>
    </div>
  );
}

function CustomerBehaviorCard({ behavior }: { behavior?: Analytics["customerBehavior"] }) {
  const totalBills = Math.max(1, Number(behavior?.totalBills || 0));
  const walkInPct = (Number(behavior?.walkInBills || 0) / totalBills) * 100;
  const knownPct = (Number(behavior?.knownBills || 0) / totalBills) * 100;
  return (
    <div className="card p-5">
      <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" /> Customer Behaviour
      </h2>
      <p className="text-xs text-text-secondary mt-1">Walk-in vs known customer pattern from the selected history window.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniStat label="Walk-in bills" value={`${Math.round(walkInPct)}%`} sub={`${behavior?.walkInBills || 0} bills`} />
        <MiniStat label="Known bills" value={`${Math.round(knownPct)}%`} sub={`${behavior?.knownCustomers || 0} customers`} />
      </div>
      <div className="mt-4 h-2 rounded-full bg-surface-3 overflow-hidden flex">
        <div className="h-full bg-primary" style={{ width: `${knownPct}%` }} />
        <div className="h-full bg-info" style={{ width: `${walkInPct}%` }} />
      </div>
      <div className="mt-4 space-y-2">
        {(behavior?.repeatCustomers || []).slice(0, 3).map((customer) => (
          <div key={customer.id} className="flex justify-between gap-3 text-xs">
            <span className="truncate text-text-secondary">{customer.name}</span>
            <strong>{customer.visits} visits · {rs(customer.revenue)}</strong>
          </div>
        ))}
        {(behavior?.repeatCustomers || []).length === 0 && (
          <p className="text-xs text-text-secondary">No repeat khata/customer pattern yet.</p>
        )}
      </div>
    </div>
  );
}

function DailyVolumeChart({ dailyTrend }: { dailyTrend: DayPoint[] }) {
  if (dailyTrend.length === 0) {
    return (
      <div className="text-text-secondary text-sm w-full text-center py-10">
        Not enough sales data yet — make at least one sale.
      </div>
    );
  }

  // Pre-format the X-axis label so recharts can render it directly. We
  // keep the raw ISO date too — the tooltip uses it for the full header.
  const chartData = dailyTrend.map((day) => ({
    date: day.date,
    label: formatChartDateShort(day.date),
    milkKg: Number(day.milkKg || 0),
    yogurtKg: Number(day.yogurtKg || 0),
    revenue: Number(day.revenue || 0),
    bills: Number(day.bills || 0)
  }));

  // Stride x-axis ticks so 30/60/90-day windows don't smash labels together.
  const stride = Math.max(1, Math.ceil(chartData.length / 10));
  const tickIndexes = chartData
    .map((_, idx) => idx)
    .filter((idx) => idx === 0 || idx === chartData.length - 1 || idx % stride === 0);
  const tickValues = tickIndexes.map((idx) => chartData[idx].label);

  return (
    <div className="w-full h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            ticks={tickValues}
            interval="preserveStartEnd"
            tick={{ fill: CHART_COLORS.axis, fontSize: 10, fontFamily: "Consolas, monospace" }}
            axisLine={{ stroke: CHART_COLORS.grid }}
            tickLine={false}
          />
          <YAxis
            yAxisId="kg"
            tick={{ fill: CHART_COLORS.axis, fontSize: 10, fontFamily: "Consolas, monospace" }}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(value: number) => `${value.toFixed(0)}kg`}
          />
          <YAxis
            yAxisId="rs"
            orientation="right"
            tick={{ fill: CHART_COLORS.axis, fontSize: 10, fontFamily: "Consolas, monospace" }}
            axisLine={false}
            tickLine={false}
            width={64}
            tickFormatter={(value: number) =>
              value >= 1000 ? `${Math.round(value / 1000)}k` : `${Math.round(value)}`
            }
          />
          <ReTooltip
            cursor={{ fill: "rgba(56,139,253,0.08)" }}
            content={<DailyVolumeTooltip />}
          />
          <Bar
            yAxisId="kg"
            dataKey="milkKg"
            stackId="vol"
            fill={CHART_COLORS.milk}
            radius={[0, 0, 0, 0]}
            maxBarSize={32}
          />
          <Bar
            yAxisId="kg"
            dataKey="yogurtKg"
            stackId="vol"
            fill={CHART_COLORS.yogurt}
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
          <Line
            yAxisId="rs"
            type="monotone"
            dataKey="revenue"
            stroke={CHART_COLORS.revenue}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, fill: CHART_COLORS.revenue, stroke: "#0d1117", strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function DailyVolumeTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload as {
    date: string;
    milkKg: number;
    yogurtKg: number;
    revenue: number;
    bills: number;
  };
  const combined = row.milkKg + row.yogurtKg;
  return (
    <div className="rounded-lg border border-surface-4 bg-surface-1/95 shadow-float px-3 py-2 text-xs font-mono">
      <div className="font-bold text-text-primary mb-1">{formatChartDate(row.date)}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">Milk</span>
        <span style={{ color: CHART_COLORS.milk }}>{kg(row.milkKg)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">Yogurt</span>
        <span style={{ color: CHART_COLORS.yogurt }}>{kg(row.yogurtKg)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-surface-4 mt-1 pt-1">
        <span className="text-text-secondary">Combined</span>
        <span className="text-text-primary">{kg(combined)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">Revenue</span>
        <span style={{ color: CHART_COLORS.revenue }}>{rs(row.revenue)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">Bills</span>
        <span className="text-text-primary">{row.bills}</span>
      </div>
    </div>
  );
}

function BuyPatternCard({
  title,
  subtitle,
  accent,
  pattern
}: {
  title: string;
  subtitle: string;
  accent: string;
  pattern?: BuyPattern;
}) {
  const top = pattern?.top || [];
  const totalBills = pattern?.totalBillsWithItem || 0;
  const headline = pattern?.mostCommonQty || 0;
  const headlineShare = pattern?.mostCommonSharePct || 0;
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <Milk className="w-5 h-5" style={{ color: accent }} /> {title}
          </h2>
          <p className="text-xs text-text-secondary mt-1">{subtitle}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
          {totalBills.toLocaleString("en-PK")} bills
        </span>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-text-secondary mt-6">No sales yet in this window.</p>
      ) : (
        <>
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Most common</p>
            <p className="text-4xl font-black mt-1" style={{ color: accent }}>{headline} kg</p>
            <p className="text-xs text-text-secondary mt-1">{headlineShare.toFixed(1)}% of {title.split(" ")[0].toLowerCase()} bills</p>
          </div>
          <div className="mt-4 space-y-2">
            {top.map((row) => (
              <div key={row.qty}>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-text-primary font-bold">{row.qty} kg</span>
                  <span className="text-text-secondary">{row.bills} bills · {row.sharePct.toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                  <div className="h-full" style={{
                    width: `${Math.max(2, Math.min(100, row.sharePct))}%`,
                    background: accent,
                    opacity: 0.7
                  }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MilkYogurtMixCard({ mix }: { mix?: Analytics["milkYogurtMix"] }) {
  const bills = mix?.bills;
  const customers = mix?.knownCustomers;
  const total = bills?.total || 0;
  const knownTotal = customers?.total || 0;
  const pct = (numerator: number, denom: number) => denom > 0 ? (numerator / denom) * 100 : 0;
  // Build a 3-segment stacked bar for the bill mix. We exclude "neither"
  // (items like sugar, eggs, soap) from the bar — those bills don't have
  // milk or yogurt at all.
  const billCounted = (bills?.onlyMilk || 0) + (bills?.onlyYogurt || 0) + (bills?.both || 0);
  const segments = [
    { key: "milk", label: "Only milk", value: bills?.onlyMilk || 0, color: CHART_COLORS.milk },
    { key: "both", label: "Both", value: bills?.both || 0, color: CHART_COLORS.revenue },
    { key: "yogurt", label: "Only yogurt", value: bills?.onlyYogurt || 0, color: CHART_COLORS.yogurt }
  ];
  return (
    <div className="card p-5">
      <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" /> Milk vs Yogurt Mix
      </h2>
      <p className="text-xs text-text-secondary mt-1">
        Last {mix?.windowDays || 30} days — who buys what.
      </p>
      {total === 0 ? (
        <p className="text-sm text-text-secondary mt-6">No bills yet in this window.</p>
      ) : (
        <>
          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">Per bill</p>
            <div className="mt-2 h-3 rounded-full bg-surface-3 overflow-hidden flex">
              {segments.map((seg) => (
                <div
                  key={seg.key}
                  className="h-full"
                  style={{ width: `${pct(seg.value, billCounted)}%`, background: seg.color }}
                  title={`${seg.label}: ${seg.value} bills`}
                />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {segments.map((seg) => (
                <div key={seg.key} className="rounded-lg border border-surface-4 bg-surface-2/60 p-2">
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm" style={{ background: seg.color }} />
                    <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">{seg.label}</p>
                  </div>
                  <p className="font-mono font-bold text-text-primary mt-1">{seg.value.toLocaleString("en-PK")}</p>
                  <p className="text-[10px] text-text-secondary">{pct(seg.value, billCounted).toFixed(0)}%</p>
                </div>
              ))}
            </div>
          </div>

          {knownTotal > 0 && (
            <div className="mt-5 rounded-lg border border-surface-4 bg-surface-2/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold mb-2">
                Known (khata) customers — {knownTotal.toLocaleString("en-PK")} unique
              </p>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <p className="font-mono font-bold" style={{ color: CHART_COLORS.milk }}>{customers?.onlyMilk || 0}</p>
                  <p className="text-text-secondary">Only milk</p>
                </div>
                <div>
                  <p className="font-mono font-bold" style={{ color: CHART_COLORS.revenue }}>{customers?.both || 0}</p>
                  <p className="text-text-secondary">Both</p>
                </div>
                <div>
                  <p className="font-mono font-bold" style={{ color: CHART_COLORS.yogurt }}>{customers?.onlyYogurt || 0}</p>
                  <p className="text-text-secondary">Only yogurt</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MilkCostCard({ milkCost, isToday }: { milkCost?: MilkCost; isToday: boolean }) {
  if (!milkCost || milkCost.today.totalKg === 0) {
    return (
      <div className="card p-5">
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <Milk className="w-5 h-5" style={{ color: CHART_COLORS.milk }} /> Milk Procurement Cost
        </h2>
        <p className="text-sm text-text-secondary mt-2">
          {isToday
            ? "No milk collections recorded yet today. As farmers' entries arrive, this card will show your weighted average buy rate per kg."
            : "No milk collections recorded for this date."}
        </p>
      </div>
    );
  }

  const { today: milkToday, window, selling, dailyTrend } = milkCost;
  const todayVsWindow = window.avgRatePerKg > 0
    ? ((milkToday.avgRatePerKg - window.avgRatePerKg) / window.avgRatePerKg) * 100
    : 0;
  const todayHigherThanAvg = todayVsWindow > 0.5;
  const todayLowerThanAvg = todayVsWindow < -0.5;
  const trendData = (dailyTrend || []).filter((row) => row.totalKg > 0).map((row) => ({
    date: row.date,
    label: formatChartDateShort(row.date),
    rate: row.avgRatePerKg
  }));

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <Milk className="w-5 h-5" style={{ color: CHART_COLORS.milk }} /> Milk Procurement Cost
          </h2>
          <p className="text-xs text-text-secondary mt-1">
            Weighted average paid per kg — every supplier and milk type combined.
          </p>
        </div>
        {window.avgRatePerKg > 0 && (
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 px-2 py-0.5 rounded-full border",
              todayHigherThanAvg && "text-danger border-danger/30",
              todayLowerThanAvg && "text-success border-success/30",
              !todayHigherThanAvg && !todayLowerThanAvg && "text-text-secondary border-surface-4"
            )}
            title={`Window avg: Rs. ${window.avgRatePerKg.toFixed(2)}/kg over last ${window.days} days`}
          >
            {todayHigherThanAvg ? <TrendingUp className="w-3 h-3" /> : todayLowerThanAvg ? <TrendingDown className="w-3 h-3" /> : <BarChart3 className="w-3 h-3" />}
            {todayVsWindow > 0 ? "+" : ""}{todayVsWindow.toFixed(1)}% vs {window.days}d avg
          </span>
        )}
      </div>

      <div className="mt-4">
        <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">Avg buy rate today</p>
        <p className="text-4xl font-black mt-1" style={{ color: CHART_COLORS.milk }}>
          Rs. {milkToday.avgRatePerKg.toFixed(2)}<span className="text-base text-text-secondary font-mono"> / kg</span>
        </p>
        <p className="text-xs text-text-secondary mt-1">
          {milkToday.totalKg.toFixed(2)} kg in for {rs(milkToday.totalSpend)} · {milkToday.supplierCount} farmer{milkToday.supplierCount === 1 ? "" : "s"} · {milkToday.entryCount} entries
        </p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <MiniStat
          label="Cow"
          value={milkToday.cow.kg > 0 ? `Rs. ${milkToday.cow.avgRate.toFixed(2)}` : "—"}
          sub={milkToday.cow.kg > 0 ? `${milkToday.cow.kg.toFixed(2)} kg` : "no entry"}
        />
        <MiniStat
          label="Buffalo"
          value={milkToday.buffalo.kg > 0 ? `Rs. ${milkToday.buffalo.avgRate.toFixed(2)}` : "—"}
          sub={milkToday.buffalo.kg > 0 ? `${milkToday.buffalo.kg.toFixed(2)} kg` : "no entry"}
        />
        <MiniStat
          label="Mixed"
          value={milkToday.mixed.kg > 0 ? `Rs. ${milkToday.mixed.avgRate.toFixed(2)}` : "—"}
          sub={milkToday.mixed.kg > 0 ? `${milkToday.mixed.kg.toFixed(2)} kg` : "no entry"}
        />
      </div>

      {selling.milkRate > 0 && (
        <div className={cn(
          "mt-4 rounded-lg border p-3 flex items-center justify-between gap-3",
          selling.marginPerKg >= 0 ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
        )}>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">
              {selling.marginPerKg >= 0 ? "Per-kg margin" : "Per-kg LOSS"}
            </p>
            <p className={cn(
              "font-mono font-bold text-lg",
              selling.marginPerKg >= 0 ? "text-success" : "text-danger"
            )}>
              Rs. {Math.abs(selling.marginPerKg).toFixed(2)} <span className="text-xs text-text-secondary">({Math.abs(selling.marginPct).toFixed(1)}%)</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-text-secondary">Selling at</p>
            <p className="font-mono font-bold text-text-primary">Rs. {selling.milkRate.toFixed(2)}/kg</p>
          </div>
        </div>
      )}

      {(milkToday.cheapestSupplier || milkToday.priciestSupplier) && milkToday.cheapestSupplier?.rate !== milkToday.priciestSupplier?.rate && (
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          {milkToday.cheapestSupplier && (
            <div className="rounded-lg border border-success/20 bg-success/5 p-2">
              <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">Cheapest</p>
              <p className="font-bold text-text-primary truncate" title={milkToday.cheapestSupplier.name}>{milkToday.cheapestSupplier.name}</p>
              <p className="font-mono text-success">Rs. {milkToday.cheapestSupplier.rate.toFixed(2)} ({milkToday.cheapestSupplier.milkType.toLowerCase()})</p>
            </div>
          )}
          {milkToday.priciestSupplier && (
            <div className="rounded-lg border border-danger/20 bg-danger/5 p-2">
              <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">Priciest</p>
              <p className="font-bold text-text-primary truncate" title={milkToday.priciestSupplier.name}>{milkToday.priciestSupplier.name}</p>
              <p className="font-mono text-danger">Rs. {milkToday.priciestSupplier.rate.toFixed(2)} ({milkToday.priciestSupplier.milkType.toLowerCase()})</p>
            </div>
          )}
        </div>
      )}

      {trendData.length >= 3 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold mb-1">
            Last {window.days} days · avg Rs. {window.avgRatePerKg.toFixed(2)}/kg
          </p>
          <div className="h-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="milkCostFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.milk} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={CHART_COLORS.milk} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <ReTooltip
                  content={({ active, payload }: any) => {
                    if (!active || !payload || !payload.length) return null;
                    const row = payload[0].payload as { date: string; rate: number };
                    return (
                      <div className="rounded border border-surface-4 bg-surface-1/95 px-2 py-1 text-[11px] font-mono">
                        <div className="text-text-primary font-bold">{formatChartDateShort(row.date)}</div>
                        <div style={{ color: CHART_COLORS.milk }}>Rs. {row.rate.toFixed(2)}/kg</div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="rate"
                  stroke={CHART_COLORS.milk}
                  strokeWidth={2}
                  fill="url(#milkCostFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function SameDayLastYearCard({
  sameDay,
  todayKpis,
  pickedDate
}: {
  sameDay: Analytics["sameDayLastYear"] | null;
  todayKpis: TodayKpis;
  pickedDate: string;
}) {
  if (!sameDay) {
    return (
      <div className="card p-5">
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <Calendar className="w-5 h-5 text-info" /> Same Day Last Year
        </h2>
        <p className="text-sm text-text-secondary mt-2">
          Once you have a full year of sales history, this card will show how today compares to
          the same day in {Number(pickedDate.slice(0, 4)) - 1}. Especially useful around Eid, Muharram, school
          holidays, and other patterns that repeat year-after-year.
        </p>
      </div>
    );
  }

  const revDelta = sameDay.revenueDeltaPct;
  const billDelta = sameDay.billsDeltaPct;
  const positive = (delta: number | null) => delta != null && delta > 0;
  const negative = (delta: number | null) => delta != null && delta < 0;
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <Calendar className="w-5 h-5 text-info" /> Same Day Last Year
          </h2>
          <p className="text-xs text-text-secondary mt-1">
            Comparing {format(new Date(`${pickedDate}T00:00:00`), "EEE, dd MMM yyyy")} vs {format(new Date(`${sameDay.date}T00:00:00`), "EEE, dd MMM yyyy")}.
            Watch for Eid / Muharram / festival shifts that move a few days year-over-year.
          </p>
        </div>
      </div>

      <div className="mt-5 grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-surface-4 bg-surface-2/60 p-4">
          <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">Revenue</p>
          <div className="mt-1 flex items-end gap-3 flex-wrap">
            <div>
              <p className="font-mono font-bold text-2xl text-text-primary">{rs(todayKpis.revenue || 0)}</p>
              <p className="text-[10px] text-text-secondary">Today</p>
            </div>
            <div>
              <p className="font-mono font-bold text-text-secondary">{rs(sameDay.revenue)}</p>
              <p className="text-[10px] text-text-secondary">Last year</p>
            </div>
            {revDelta != null && (
              <span className={cn(
                "ml-auto inline-flex items-center gap-1 text-sm font-bold",
                positive(revDelta) && "text-success",
                negative(revDelta) && "text-danger",
                !positive(revDelta) && !negative(revDelta) && "text-text-secondary"
              )}>
                {positive(revDelta) && <TrendingUp className="w-4 h-4" />}
                {negative(revDelta) && <TrendingDown className="w-4 h-4" />}
                {revDelta > 0 ? "+" : ""}{revDelta.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-surface-4 bg-surface-2/60 p-4">
          <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">Bills</p>
          <div className="mt-1 flex items-end gap-3 flex-wrap">
            <div>
              <p className="font-mono font-bold text-2xl text-text-primary">{(todayKpis.bills || 0).toLocaleString("en-PK")}</p>
              <p className="text-[10px] text-text-secondary">Today</p>
            </div>
            <div>
              <p className="font-mono font-bold text-text-secondary">{sameDay.bills.toLocaleString("en-PK")}</p>
              <p className="text-[10px] text-text-secondary">Last year</p>
            </div>
            {billDelta != null && (
              <span className={cn(
                "ml-auto inline-flex items-center gap-1 text-sm font-bold",
                positive(billDelta) && "text-success",
                negative(billDelta) && "text-danger",
                !positive(billDelta) && !negative(billDelta) && "text-text-secondary"
              )}>
                {positive(billDelta) && <TrendingUp className="w-4 h-4" />}
                {negative(billDelta) && <TrendingDown className="w-4 h-4" />}
                {billDelta > 0 ? "+" : ""}{billDelta.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg border border-surface-4 bg-surface-2/40 p-2">
          <p className="text-text-secondary">Milk LY</p>
          <p className="font-mono font-bold" style={{ color: CHART_COLORS.milk }}>{kg(sameDay.milkKg)}</p>
        </div>
        <div className="rounded-lg border border-surface-4 bg-surface-2/40 p-2">
          <p className="text-text-secondary">Yogurt LY</p>
          <p className="font-mono font-bold" style={{ color: CHART_COLORS.yogurt }}>{kg(sameDay.yogurtKg)}</p>
        </div>
        <div className="rounded-lg border border-surface-4 bg-surface-2/40 p-2">
          <p className="text-text-secondary">±3 days LY</p>
          <p className="font-mono font-bold text-text-primary">{rs(sameDay.window.revenue)}</p>
          <p className="text-[9px] text-text-secondary">{sameDay.window.bills.toLocaleString("en-PK")} bills</p>
        </div>
      </div>
    </div>
  );
}

function RevenuePulseChart({ dailyTrend }: { dailyTrend: DayPoint[] }) {
  if (dailyTrend.length === 0) {
    return <div className="h-28 flex items-center justify-center text-xs text-text-secondary">No sales yet.</div>;
  }
  const data = dailyTrend.map((d) => ({
    date: d.date,
    label: formatChartDateShort(d.date),
    revenue: Number(d.revenue || 0),
    bills: Number(d.bills || 0)
  }));
  return (
    <div className="w-full h-28">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.revenue} stopOpacity={0.55} />
              <stop offset="100%" stopColor={CHART_COLORS.revenue} stopOpacity={0} />
            </linearGradient>
          </defs>
          <ReTooltip
            cursor={{ stroke: CHART_COLORS.revenue, strokeWidth: 1, strokeOpacity: 0.4 }}
            content={<PulseTooltip />}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke={CHART_COLORS.revenue}
            strokeWidth={2.5}
            fill="url(#pulseFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function PulseTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload as { date: string; revenue: number; bills: number };
  return (
    <div className="rounded-lg border border-surface-4 bg-surface-1/95 shadow-float px-3 py-2 text-xs font-mono">
      <div className="font-bold text-text-primary mb-1">{formatChartDate(row.date)}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">Revenue</span>
        <span style={{ color: CHART_COLORS.revenue }}>{rs(row.revenue)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">Bills</span>
        <span className="text-text-primary">{row.bills}</span>
      </div>
    </div>
  );
}

const HOURLY_FILL = CHART_COLORS.milk;

function HourlyCustomersChart({ hourly }: { hourly: HourPoint[] }) {
  const data = hourly.map((h) => ({
    hour: h.hour,
    label: formatHour(h.hour, true),
    bills: Number(h.bills || 0),
    revenue: Number(h.revenue || 0)
  }));
  const activeHours = data.filter((row) => row.bills > 0);
  const avgBills = activeHours.length
    ? activeHours.reduce((sum, row) => sum + row.bills, 0) / activeHours.length
    : 0;
  return (
    <div className="w-full h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART_COLORS.axis, fontSize: 10, fontFamily: "Consolas, monospace" }}
            axisLine={{ stroke: CHART_COLORS.grid }}
            tickLine={false}
            interval={2}
          />
          <YAxis
            tick={{ fill: CHART_COLORS.axis, fontSize: 10, fontFamily: "Consolas, monospace" }}
            axisLine={false}
            tickLine={false}
            width={32}
            allowDecimals={false}
          />
          {avgBills > 0 && (
            <ReferenceLine
              y={avgBills}
              stroke={CHART_COLORS.revenue}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={{
                value: `avg ${avgBills.toFixed(0)}`,
                position: "right",
                fill: CHART_COLORS.revenue,
                fontSize: 10,
                fontFamily: "Consolas, monospace"
              }}
            />
          )}
          <ReTooltip cursor={{ fill: "rgba(56,139,253,0.08)" }} content={<HourlyTooltip />} />
          <Bar dataKey="bills" fill={HOURLY_FILL} radius={[4, 4, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HourlyTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload as { hour: number; bills: number; revenue: number };
  return (
    <div className="rounded-lg border border-surface-4 bg-surface-1/95 shadow-float px-3 py-2 text-xs font-mono">
      <div className="font-bold text-text-primary mb-1">{formatHour(row.hour)}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">Bills</span>
        <span className="text-text-primary">{row.bills}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">Revenue</span>
        <span style={{ color: CHART_COLORS.revenue }}>{rs(row.revenue)}</span>
      </div>
    </div>
  );
}

const DONUT_PALETTE = [
  "#388bfd", "#d29922", "#2ea043", "#a371f7", "#f85149",
  "#3fb950", "#d4a017", "#1f6feb", "#bf3989", "#8b949e"
];

function DonutChart({
  data,
  total,
  centerLabel,
  centerValue
}: {
  data: Array<{ name: string; value: number }>;
  total: number;
  centerLabel: string;
  centerValue: string;
}) {
  if (!data.length || total <= 0) {
    return (
      <div className="w-full h-48 flex items-center justify-center text-sm text-text-secondary">
        No data yet.
      </div>
    );
  }
  return (
    <div className="relative w-full h-48">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <ReTooltip
            content={({ active, payload }: any) => {
              if (!active || !payload || !payload.length) return null;
              const entry = payload[0];
              const pct = total > 0 ? (entry.value / total) * 100 : 0;
              return (
                <div className="rounded-lg border border-surface-4 bg-surface-1/95 shadow-float px-3 py-2 text-xs font-mono">
                  <div className="font-bold text-text-primary mb-1">{entry.name}</div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-text-secondary">Amount</span>
                    <span className="text-text-primary">{rs(entry.value)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-text-secondary">Share</span>
                    <span style={{ color: CHART_COLORS.revenue }}>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              );
            }}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={72}
            paddingAngle={2}
            stroke="#0d1117"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((_, idx) => (
              <Cell key={idx} fill={DONUT_PALETTE[idx % DONUT_PALETTE.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">{centerLabel}</span>
        <span className="text-base font-mono font-bold text-text-primary">{centerValue}</span>
      </div>
    </div>
  );
}

function DonutLegend({ rows }: { rows: Array<{ name: string; value: string; sub?: string }> }) {
  return (
    <div className="space-y-2 text-sm">
      {rows.map((row, idx) => (
        <div key={row.name + idx} className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-sm shrink-0"
            style={{ background: DONUT_PALETTE[idx % DONUT_PALETTE.length] }}
          />
          <span className="flex-1 truncate text-text-primary">{row.name}</span>
          <span className="font-mono text-text-secondary">{row.value}</span>
          {row.sub && <span className="font-mono text-[10px] text-text-secondary">{row.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-surface-4 bg-surface-2/60 p-2">
      <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold">{label}</p>
      <p className="font-mono font-bold text-text-primary">{value}</p>
      {sub ? <p className="text-[10px] text-text-secondary">{sub}</p> : null}
    </div>
  );
}

function formatHour(h: number, short = false) {
  const ampm = h < 12 ? "am" : "pm";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return short ? `${hh}${ampm}` : `${hh}:00 ${ampm.toUpperCase()}`;
}

function KpiCard({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "primary" | "success" | "info" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 flex flex-col gap-2 bg-surface-2/40",
        tone === "primary" && "border-primary/30",
        tone === "success" && "border-success/30",
        tone === "info" && "border-info/30",
        tone === "warning" && "border-warning/30",
        !tone && "border-surface-4"
      )}
    >
      <div className="flex items-center gap-2 text-text-secondary">
        {icon}
        <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div
        className={cn(
          "text-2xl font-bold",
          tone === "primary" && "text-primary",
          tone === "success" && "text-success",
          tone === "info" && "text-info",
          tone === "warning" && "text-warning",
          !tone && "text-text-primary"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function CompareCard({
  title,
  current,
  previous
}: {
  title: string;
  current: PeriodSummary;
  previous: PeriodSummary;
}) {
  const billsDelta = deltaPct(current.bills, previous.bills);
  const revDelta = deltaPct(current.revenue, previous.revenue);
  const milkDelta = deltaPct(current.milkKg, previous.milkKg);
  const yogurtDelta = deltaPct(current.yogurtKg, previous.yogurtKg);
  const avgBillDelta = deltaPct(current.avgBill, previous.avgBill);

  return (
    <div className="card p-5">
      <h3 className="text-sm font-bold uppercase tracking-widest text-text-secondary mb-4">
        {title}
      </h3>
      <div className="space-y-3">
        <CompareRow
          label="Customers Served"
          current={current.bills.toLocaleString("en-PK")}
          previous={previous.bills.toLocaleString("en-PK")}
          delta={billsDelta}
        />
        <CompareRow
          label="Total Revenue"
          current={rs(current.revenue)}
          previous={rs(previous.revenue)}
          delta={revDelta}
        />
        <CompareRow
          label="Avg Bill"
          current={rs(current.avgBill)}
          previous={rs(previous.avgBill)}
          delta={avgBillDelta}
        />
        <CompareRow
          label="Milk Sold"
          current={kg(current.milkKg)}
          previous={kg(previous.milkKg)}
          delta={milkDelta}
        />
        <CompareRow
          label="Yogurt Sold"
          current={kg(current.yogurtKg)}
          previous={kg(previous.yogurtKg)}
          delta={yogurtDelta}
        />
      </div>
    </div>
  );
}

function InsightPanel({
  title,
  icon,
  children
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <h2 className="text-lg font-bold text-text-primary flex items-center gap-2 mb-4">
        {icon}
        {title}
      </h2>
      <ul className="space-y-2 text-sm text-text-secondary">
        {children}
      </ul>
    </div>
  );
}

function CompareRow({
  label,
  current,
  previous,
  delta
}: {
  label: string;
  current: string;
  previous: string;
  delta: number | null;
}) {
  const positive = delta !== null && delta > 0;
  const negative = delta !== null && delta < 0;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-surface-4 pb-2 last:border-b-0 last:pb-0">
      <div className="flex-1">
        <div className="text-xs text-text-secondary uppercase font-bold">{label}</div>
        <div className="text-sm text-text-primary font-mono mt-0.5">
          {current}{" "}
          <span className="text-text-secondary text-xs">
            (was {previous})
          </span>
        </div>
      </div>
      <div
        className={cn(
          "flex items-center gap-1 font-bold text-sm",
          positive && "text-success",
          negative && "text-danger",
          !positive && !negative && "text-text-secondary"
        )}
      >
        {positive && <TrendingUp className="w-4 h-4" />}
        {negative && <TrendingDown className="w-4 h-4" />}
        {delta !== null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%` : "—"}
      </div>
    </div>
  );
}
