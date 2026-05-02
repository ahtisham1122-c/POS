import { useState, useEffect, useMemo } from "react";
import { TrendingUp, Receipt, Banknote, AlertCircle, ShoppingCart, UserPlus, PackagePlus, Banknote as MoneyIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "../lib/utils";

export default function Dashboard({ setPage }: { setPage: (p: any) => void }) {
  const [greeting, setGreeting] = useState("Good morning");
  const [now] = useState(new Date());
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    const hour = now.getHours();
    if (hour < 12) setGreeting("Good morning");
    else if (hour < 17) setGreeting("Good afternoon");
    else setGreeting("Good evening");
  }, [now]);

  const maxChartValue = useMemo(() => Math.max(...chartData.map(d => d.total), 1), [chartData]);

  const loadStats = async () => {
    try {
      setIsLoading(true);
      const [s, c] = await Promise.all([
        window.electronAPI?.reports?.getDashboardStats(),
        window.electronAPI?.reports?.getSalesChart(7)
      ]);
      setStats(s);
      
      // Pad chart data to 7 days if missing
      const last7 = Array.from({length: 7}, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const dateStr = d.toISOString().split('T')[0];
        const existing = c.find((row: any) => row.date === dateStr);
        return { 
          day: format(d, "E"), 
          date: dateStr,
          total: existing ? existing.total : 0 
        };
      });
      setChartData(last7);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const kpis = stats ? [
    { label: "Gross Sales", value: `Rs. ${(stats.kpis.grossSales ?? stats.kpis.revenue).toLocaleString()}`, trend: "Before refunds", icon: TrendingUp, color: "text-success", bg: "bg-success/15" },
    { label: "Refunds", value: `Rs. ${(stats.kpis.refunds ?? 0).toLocaleString()}`, trend: "Returned money", icon: AlertCircle, color: "text-warning", bg: "bg-warning/15" },
    { label: "Net Sales", value: `Rs. ${(stats.kpis.netSales ?? stats.kpis.revenue).toLocaleString()}`, trend: "Gross minus refunds", icon: Receipt, color: "text-info", bg: "bg-info/15" },
    { label: "Bills Today", value: stats.kpis.bills.toString(), trend: "Transactions count", icon: Receipt, color: "text-info", bg: "bg-info/15" },
    { label: "Expected Cash", value: `Rs. ${(stats.kpis.expectedCash ?? stats.kpis.cashOnHand).toLocaleString()}`, trend: "From cash register", icon: Banknote, color: "text-success", bg: "bg-success/15" },
    { label: "Outstanding Dues", value: `Rs. ${stats.kpis.dues.toLocaleString()}`, trend: `${stats.kpis.dueCount} customers owe`, icon: AlertCircle, color: "text-danger", bg: "bg-danger/15" },
  ] : [];

  const recentActivity = stats?.recentSales || [];
  const topProducts = stats?.topProducts || [];
  const stockAlerts = stats?.stockAlerts || [];

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto animate-pulse">
        <div className="h-10 w-48 bg-surface-3 rounded mb-4"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-surface-3 rounded-xl"></div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 h-[320px] bg-surface-3 rounded-xl"></div>
          <div className="lg:col-span-2 h-[320px] bg-surface-3 rounded-xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      {/* GREETING HEADER */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{greeting}, Admin 👋</h1>
        <p className="text-text-secondary">{format(now, "EEEE, dd MMMM yyyy")}</p>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <div key={i} className="card p-5 flex items-center gap-4">
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center shrink-0", kpi.bg)}>
                <Icon className={cn("w-6 h-6", kpi.color)} />
              </div>
              <div>
                <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">{kpi.label}</p>
                <p className="text-2xl font-bold text-text-primary">{kpi.value}</p>
                <p className={cn("text-xs mt-1", kpi.label === "Outstanding Dues" && stats.kpis.dues > 0 ? "text-danger" : "text-success")}>
                  {kpi.trend}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* MIDDLE SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="card p-5 lg:col-span-3">
          <h3 className="text-lg font-semibold mb-6">Revenue This Week</h3>
          <div className="flex items-end justify-between gap-2 h-48 mt-8">
            {chartData.map((d, i) => {
              const height = (d.total / maxChartValue) * 100;
              const isToday = d.date === format(now, "yyyy-MM-dd");
              return (
                <div key={i} className="flex flex-col items-center gap-2 flex-1 group">
                  <div className="w-full relative flex items-end justify-center h-full bg-surface-3 rounded-t-md overflow-hidden">
                    <div 
                      className={cn("w-full rounded-t-md transition-all duration-700 ease-out", isToday ? "bg-accent shadow-glow" : "bg-primary")}
                      style={{ height: `${height}%` }}
                    />
                    <div className="absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity bg-surface-4 text-xs font-mono px-2 py-1 rounded -translate-y-full mb-1 z-10">
                      Rs.{d.total.toLocaleString()}
                    </div>
                  </div>
                  <span className={cn("text-xs font-medium", isToday ? "text-accent" : "text-text-secondary")}>{d.day}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-5 lg:col-span-2 flex flex-col h-[320px]">
          <h3 className="text-lg font-semibold mb-4">Today's Sales</h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
            {recentActivity.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-secondary text-sm">
                <Receipt className="w-8 h-8 mb-2 opacity-20" />
                No sales yet today
              </div>
            ) : recentActivity.map((act: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-surface-3 border border-surface-4 hover:border-primary/50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-text-secondary">{act.time}</span>
                  <span className="font-medium text-sm text-text-primary">{act.customer}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-text-primary">Rs. {act.amount.toLocaleString()}</span>
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded font-bold tracking-wider",
                    act.type === "CASH" ? "bg-success/20 text-success" : 
                    act.type === "CREDIT" ? "bg-danger/20 text-danger" : 
                    "bg-info/20 text-info"
                  )}>{act.type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* BOTTOM ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <h3 className="text-lg font-semibold mb-4">Top Sellers Today</h3>
          <div className="space-y-3">
            {topProducts.length === 0 ? (
              <p className="text-sm text-text-secondary py-4 text-center">No data yet</p>
            ) : topProducts.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={cn("font-bold", i === 0 ? "text-accent text-lg" : "text-text-secondary")}>#{i + 1}</span>
                  <span className="text-2xl">{p.emoji || "📦"}</span>
                  <div>
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-text-secondary">{p.qty.toFixed(1)} sold</p>
                  </div>
                </div>
                <span className="font-mono font-bold text-sm text-text-primary">Rs. {p.rev.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5 flex flex-col">
          <h3 className="text-lg font-semibold mb-4">Stock Alerts</h3>
          <div className="flex-1 space-y-3">
            {stockAlerts.length > 0 ? stockAlerts.map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-surface-3 p-3 rounded-lg border border-surface-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{a.emoji}</span>
                  <div>
                    <p className="text-sm font-semibold">{a.name}</p>
                    <p className="text-xs text-text-secondary">{a.qty} left</p>
                  </div>
                </div>
                <button 
                  onClick={() => setPage('inventory')}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-surface-4 hover:bg-primary hover:text-white transition-colors"
                >
                  Restock
                </button>
              </div>
            )) : (
              <div className="h-full flex flex-col items-center justify-center text-success">
                <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-2">
                  <span className="text-xl">✓</span>
                </div>
                <p className="font-medium text-sm">All stocks healthy</p>
              </div>
            )}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: ShoppingCart, label: "New Sale", target: "pos" },
              { icon: UserPlus, label: "Add Customer", target: "customers" },
              { icon: PackagePlus, label: "Add Stock", target: "inventory" },
              { icon: MoneyIcon, label: "Add Expense", target: "expenses" },
            ].map((act, i) => (
              <button 
                key={i} 
                onClick={() => setPage(act.target)}
                className="card-hover bg-surface-3 p-4 flex flex-col items-center justify-center gap-2 rounded-xl text-text-secondary hover:text-primary transition-colors"
              >
                <act.icon className="w-8 h-8" />
                <span className="text-xs font-semibold">{act.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
