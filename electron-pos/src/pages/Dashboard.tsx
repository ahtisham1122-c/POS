import { useState, useEffect, useMemo } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Banknote,
  Boxes,
  CalendarDays,
  CreditCard,
  Package,
  PackagePlus,
  Receipt,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Wallet,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "../lib/utils";

type ChartRow = {
  day: string;
  date: string;
  total: number;
};

function money(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function compactMoney(value: number) {
  const amount = Number(value || 0);
  if (amount >= 100000) return `Rs. ${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `Rs. ${(amount / 1000).toFixed(1)}K`;
  return money(amount);
}

function paymentTone(type: string) {
  if (type === "CASH") return "bg-success/10 text-success border-success/20";
  if (type === "CREDIT") return "bg-danger/10 text-danger border-danger/20";
  if (type === "ONLINE") return "bg-info/10 text-info border-info/20";
  if (type === "SPLIT") return "bg-warning/10 text-warning border-warning/20";
  return "bg-surface-4 text-text-secondary border-surface-4";
}

export default function Dashboard({ setPage }: { setPage: (p: any) => void }) {
  const [greeting, setGreeting] = useState("Good morning");
  const [now] = useState(new Date());
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [chartData, setChartData] = useState<ChartRow[]>([]);

  useEffect(() => {
    const hour = now.getHours();
    if (hour < 12) setGreeting("Good morning");
    else if (hour < 17) setGreeting("Good afternoon");
    else setGreeting("Good evening");
  }, [now]);

  useEffect(() => {
    window.electronAPI?.auth?.getMe?.().then((currentUser) => setUser(currentUser));
  }, []);

  const loadStats = async () => {
    try {
      setIsLoading(true);
      const [s, c] = await Promise.all([
        window.electronAPI?.reports?.getDashboardStats(),
        window.electronAPI?.reports?.getSalesChart(7),
      ]);
      setStats(s);

      const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const dateStr = format(d, "yyyy-MM-dd");
        const existing = (c || []).find((row: any) => row.date === dateStr);
        return {
          day: format(d, "EEE"),
          date: dateStr,
          total: Math.max(0, Number(existing?.total || 0)),
        };
      });
      setChartData(last7);
    } catch (err) {
      console.error("Dashboard load failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 60000);
    return () => clearInterval(interval);
  }, []);

  const maxChartValue = useMemo(() => Math.max(...chartData.map((d) => d.total), 1), [chartData]);
  const weekTotal = useMemo(() => chartData.reduce((sum, row) => sum + row.total, 0), [chartData]);
  const bestDay = useMemo(
    () => chartData.reduce((best, row) => (row.total > best.total ? row : best), chartData[0] || { day: "-", total: 0 }),
    [chartData]
  );

  const kpis = stats ? [
    {
      label: "Net Sales",
      value: money(stats.kpis.netSales ?? stats.kpis.revenue),
      helper: "After real refunds",
      icon: TrendingUp,
      tone: "text-success",
      surface: "bg-success/10 border-success/20",
    },
    {
      label: "Bills Today",
      value: Number(stats.kpis.bills || 0).toString(),
      helper: "Receipts served",
      icon: Receipt,
      tone: "text-info",
      surface: "bg-info/10 border-info/20",
    },
    {
      label: "Expected Cash",
      value: money(stats.kpis.expectedCash ?? stats.kpis.cashOnHand),
      helper: "Register total",
      icon: Banknote,
      tone: "text-success",
      surface: "bg-success/10 border-success/20",
    },
    {
      label: "Cash Collected",
      value: money(stats.kpis.cashCollected || 0),
      helper: "Cash tender",
      icon: Wallet,
      tone: "text-accent",
      surface: "bg-accent/10 border-accent/20",
    },
    {
      label: "Online Sales",
      value: money(stats.kpis.onlineCollected || 0),
      helper: "JazzCash or bank",
      icon: CreditCard,
      tone: "text-primary",
      surface: "bg-primary/10 border-primary/20",
    },
    {
      label: "Khata Dues",
      value: money(stats.kpis.dues || 0),
      helper: `${Number(stats.kpis.dueCount || 0)} customers owe`,
      icon: AlertCircle,
      tone: Number(stats.kpis.dues || 0) > 0 ? "text-danger" : "text-text-secondary",
      surface: Number(stats.kpis.dues || 0) > 0 ? "bg-danger/10 border-danger/20" : "bg-surface-3 border-surface-4",
    },
  ] : [];

  const recentActivity = stats?.recentSales || [];
  const topProducts = stats?.topProducts || [];
  const stockAlerts = stats?.stockAlerts || [];
  const grossSales = Number(stats?.kpis?.grossSales ?? stats?.kpis?.revenue ?? 0);
  const refunds = Number(stats?.kpis?.refunds ?? 0);
  const netSales = Number(stats?.kpis?.netSales ?? stats?.kpis?.revenue ?? 0);
  const bills = Number(stats?.kpis?.bills || 0);
  const avgBill = bills > 0 ? netSales / bills : 0;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto animate-pulse">
        <div className="h-28 bg-surface-3 rounded-lg" />
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-28 bg-surface-3 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 h-[340px] bg-surface-3 rounded-lg" />
          <div className="lg:col-span-2 h-[340px] bg-surface-3 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto animate-slide-up">
      <section className="rounded-lg border border-surface-4 bg-surface-2 shadow-card overflow-hidden">
        <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
          <div className="p-5 md:p-6 border-b lg:border-b-0 lg:border-r border-surface-4">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-text-secondary text-sm font-medium">
                  <CalendarDays className="w-4 h-4" />
                  <span>{format(now, "EEEE, dd MMM yyyy")}</span>
                </div>
                <h1 className="mt-2 text-2xl md:text-3xl font-black text-text-primary leading-tight">
                  {greeting}{user?.name ? `, ${user.name}` : ""}
                </h1>
                <p className="mt-1 text-text-secondary max-w-2xl">
                  Live counter summary for today&apos;s shift.
                </p>
              </div>
              <button
                onClick={loadStats}
                className="btn-secondary h-11 inline-flex items-center justify-center gap-2 shrink-0"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-success/20 bg-success/10 p-4">
                <p className="text-[10px] uppercase font-bold text-success tracking-wider">Gross</p>
                <p className="mt-1 font-mono font-black text-xl text-text-primary">{compactMoney(grossSales)}</p>
              </div>
              <div className="rounded-lg border border-warning/20 bg-warning/10 p-4">
                <p className="text-[10px] uppercase font-bold text-warning tracking-wider">Refunds</p>
                <p className="mt-1 font-mono font-black text-xl text-text-primary">{compactMoney(refunds)}</p>
              </div>
              <div className="rounded-lg border border-info/20 bg-info/10 p-4">
                <p className="text-[10px] uppercase font-bold text-info tracking-wider">Net</p>
                <p className="mt-1 font-mono font-black text-xl text-text-primary">{compactMoney(netSales)}</p>
              </div>
            </div>
          </div>

          <div className="p-5 md:p-6 flex flex-col justify-between gap-5 bg-surface-1/30">
            <div>
              <p className="text-xs uppercase tracking-wider font-bold text-text-secondary">Today&apos;s pace</p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-4xl font-black font-mono text-text-primary">{bills}</p>
                  <p className="text-sm text-text-secondary">Bills served</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black font-mono text-accent">{money(avgBill)}</p>
                  <p className="text-sm text-text-secondary">Average bill</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setPage("pos")}
              className="h-14 rounded-md bg-primary text-white font-bold flex items-center justify-center gap-2 hover:bg-primary-light active:scale-[0.99] transition-all"
            >
              <ShoppingCart className="w-5 h-5" />
              New Sale
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className={cn("rounded-lg border p-4 bg-surface-2 shadow-card min-h-[122px]", kpi.surface)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-text-secondary">{kpi.label}</p>
                  <p className="mt-2 text-lg xl:text-xl font-black font-mono text-text-primary leading-tight">{kpi.value}</p>
                </div>
                <div className="w-9 h-9 rounded-md bg-surface-1 border border-surface-4 flex items-center justify-center shrink-0">
                  <Icon className={cn("w-5 h-5", kpi.tone)} />
                </div>
              </div>
              <p className="mt-3 text-xs text-text-secondary">{kpi.helper}</p>
            </div>
          );
        })}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="card p-5 lg:col-span-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Weekly Revenue</h2>
              <p className="text-sm text-text-secondary">Last 7 business days</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-xl font-black text-text-primary">{money(weekTotal)}</p>
              <p className="text-xs text-text-secondary">Best: {bestDay.day} {compactMoney(bestDay.total)}</p>
            </div>
          </div>

          <div className="mt-6 h-56 flex items-end gap-2 md:gap-3">
            {chartData.map((row) => {
              const height = row.total > 0 ? Math.max(8, (row.total / maxChartValue) * 100) : 4;
              const isToday = row.date === format(now, "yyyy-MM-dd");
              return (
                <div key={row.date} className="flex-1 h-full flex flex-col items-center justify-end gap-2 group">
                  <div className="relative w-full flex-1 flex items-end rounded-md bg-surface-3 border border-surface-4 overflow-hidden">
                    <div
                      className={cn(
                        "w-full rounded-t-sm transition-all duration-500",
                        isToday ? "bg-accent" : "bg-primary/80 group-hover:bg-primary"
                      )}
                      style={{ height: `${height}%` }}
                    />
                    <div className="absolute left-1/2 top-3 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded bg-surface-1 border border-surface-4 text-[11px] font-mono text-text-primary whitespace-nowrap">
                      {money(row.total)}
                    </div>
                  </div>
                  <span className={cn("text-xs font-bold", isToday ? "text-accent" : "text-text-secondary")}>{row.day}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-5 lg:col-span-2 h-[360px] flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Recent Sales</h2>
              <p className="text-sm text-text-secondary">Latest bills in this shift</p>
            </div>
            <Activity className="w-5 h-5 text-accent" />
          </div>
          <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
            {recentActivity.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-secondary text-sm">
                <Receipt className="w-10 h-10 mb-3 opacity-25" />
                No sales yet today
              </div>
            ) : recentActivity.map((act: any, i: number) => (
              <div key={`${act.id || i}`} className="rounded-md border border-surface-4 bg-surface-3/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-text-primary truncate">{act.customer}</p>
                    <p className="text-xs text-text-secondary font-mono">{act.time}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono font-black text-text-primary">{money(act.amount)}</p>
                    <span className={cn("inline-flex mt-1 px-2 py-0.5 rounded border text-[10px] font-bold", paymentTone(act.type))}>
                      {act.type}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Top Products</h2>
              <p className="text-sm text-text-secondary">Best sellers today</p>
            </div>
            <Boxes className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-3">
            {topProducts.length === 0 ? (
              <p className="text-sm text-text-secondary py-8 text-center">No sales data yet</p>
            ) : topProducts.map((product: any, i: number) => {
              const maxRev = Math.max(...topProducts.map((p: any) => Number(p.rev || 0)), 1);
              const pct = Math.max(4, (Number(product.rev || 0) / maxRev) * 100);
              return (
                <div key={`${product.name}-${i}`} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        "w-9 h-9 rounded-md flex items-center justify-center border shrink-0",
                        i === 0 ? "bg-accent/10 text-accent border-accent/25" : "bg-surface-3 text-text-secondary border-surface-4"
                      )}>
                        <Package className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-text-primary truncate">{product.name}</p>
                        <p className="text-xs text-text-secondary">{Number(product.qty || 0).toFixed(2)} sold</p>
                      </div>
                    </div>
                    <span className="font-mono font-black text-sm text-text-primary shrink-0">{compactMoney(product.rev)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
                    <div className={cn("h-full rounded-full", i === 0 ? "bg-accent" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Stock Watch</h2>
              <p className="text-sm text-text-secondary">Items below limit</p>
            </div>
            <AlertCircle className={cn("w-5 h-5", stockAlerts.length > 0 ? "text-warning" : "text-success")} />
          </div>
          <div className="flex-1 space-y-3">
            {stockAlerts.length > 0 ? stockAlerts.map((item: any, i: number) => (
              <div key={`${item.name}-${i}`} className="flex items-center justify-between gap-3 rounded-md bg-surface-3 border border-warning/25 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text-primary truncate">{item.name}</p>
                  <p className="text-xs text-warning font-mono">{Number(item.stock || 0).toFixed(2)} left</p>
                </div>
                <button
                  onClick={() => setPage("inventory")}
                  className="text-xs font-bold px-3 py-2 rounded-md bg-warning/10 text-warning hover:bg-warning hover:text-black transition-colors shrink-0"
                >
                  Restock
                </button>
              </div>
            )) : (
              <div className="h-full min-h-40 flex flex-col items-center justify-center rounded-md bg-success/10 border border-success/20 text-success">
                <Boxes className="w-10 h-10 mb-3" />
                <p className="font-bold text-sm">All stock looks healthy</p>
              </div>
            )}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Quick Actions</h2>
              <p className="text-sm text-text-secondary">Touch-friendly shortcuts</p>
            </div>
            <ArrowRight className="w-5 h-5 text-text-secondary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: ShoppingCart, label: "New Sale", target: "pos", tone: "hover:text-accent" },
              { icon: UserPlus, label: "Customer", target: "customers", tone: "hover:text-info" },
              { icon: PackagePlus, label: "Stock In", target: "inventory", tone: "hover:text-success" },
              { icon: Wallet, label: "Expense", target: "expenses", tone: "hover:text-warning" },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  onClick={() => setPage(action.target)}
                  className={cn(
                    "h-24 rounded-md bg-surface-3 border border-surface-4 p-3 flex flex-col items-center justify-center gap-2 text-text-secondary hover:bg-surface-4 transition-colors",
                    action.tone
                  )}
                >
                  <Icon className="w-7 h-7" />
                  <span className="text-xs font-bold">{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
