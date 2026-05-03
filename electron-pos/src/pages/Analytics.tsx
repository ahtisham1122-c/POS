import { useEffect, useMemo, useState } from "react";
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
  Calendar
} from "lucide-react";
import { cn } from "../lib/utils";

type TodayKpis = {
  bills: number;
  revenue: number;
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
  today: TodayKpis;
  hourly: HourPoint[];
  dailyTrend: DayPoint[];
  compare: {
    thisWeek: PeriodSummary;
    lastWeek: PeriodSummary;
    thisMonth: PeriodSummary;
    lastMonth: PeriodSummary;
  };
  generatedAt: string;
};

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

export default function Analytics() {
  const [data, setData] = useState<Analytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    setIsLoading(true);
    try {
      const result = await window.electronAPI?.reports?.getAnalytics();
      setData(result || null);
    } catch (err) {
      console.error("Analytics load failed", err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // Re-fetch every 60s so the owner can leave the tab open and watch
    // numbers tick up during a busy hour.
    const id = setInterval(loadData, 60000);
    return () => clearInterval(id);
  }, []);

  const maxHourBills = useMemo(
    () => Math.max(1, ...(data?.hourly?.map((h) => h.bills) || [0])),
    [data]
  );

  // For the 30-day chart we plot combined kg (milk + yogurt) — that's the
  // single number that tells the owner "is volume going up or down?"
  const maxDayCombined = useMemo(
    () => Math.max(1, ...(data?.dailyTrend?.map((d) => d.combinedKg) || [0])),
    [data]
  );

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

  const { today, hourly, dailyTrend, compare } = data;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Analytics</h1>
          <p className="text-text-secondary mt-1">
            Walk-in trends. Refreshes every minute. Last updated{" "}
            {format(new Date(data.generatedAt), "hh:mm a")}.
          </p>
        </div>
        <button
          onClick={loadData}
          className="btn-secondary flex items-center justify-center gap-2"
        >
          <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* ---------- TODAY KPI CARDS ---------- */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-text-secondary mb-3">
          Today
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

      {/* ---------- HOURLY BREAKDOWN ---------- */}
      <section className="card overflow-hidden">
        <div className="p-5 border-b border-surface-4 bg-surface-2/70">
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <Clock className="w-5 h-5 text-info" /> Hourly Customers Today
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            See your busy hours at a glance. Bar height = number of bills served.
          </p>
        </div>
        <div className="p-5">
          <div className="flex items-end gap-1 h-40">
            {hourly.map((h) => {
              const heightPct = (h.bills / maxHourBills) * 100;
              return (
                <div
                  key={h.hour}
                  className="flex-1 flex flex-col items-center justify-end min-w-0"
                  title={`${formatHour(h.hour)} — ${h.bills} bills, ${rs(h.revenue)}`}
                >
                  <div className="text-[10px] text-text-secondary font-mono mb-1">
                    {h.bills > 0 ? h.bills : ""}
                  </div>
                  <div
                    className={cn(
                      "w-full rounded-t-md transition-all",
                      h.bills > 0 ? "bg-info" : "bg-surface-3"
                    )}
                    style={{ height: `${Math.max(heightPct, h.bills > 0 ? 4 : 1)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1 mt-1">
            {hourly.map((h) => (
              <div
                key={h.hour}
                className="flex-1 text-[9px] text-text-secondary font-mono text-center"
              >
                {h.hour % 3 === 0 ? formatHour(h.hour, true) : ""}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 30-DAY TREND ---------- */}
      <section className="card overflow-hidden">
        <div className="p-5 border-b border-surface-4 bg-surface-2/70">
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <Calendar className="w-5 h-5 text-success" /> Daily Volume — Last 30 Days
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Combined milk + yogurt (kg). Spot trends — is volume rising or
            falling vs last week?
          </p>
        </div>
        <div className="p-5">
          <div className="flex items-end gap-[2px] h-44">
            {dailyTrend.length === 0 && (
              <div className="text-text-secondary text-sm w-full text-center py-10">
                Not enough sales data yet — need at least 1 day of sales.
              </div>
            )}
            {dailyTrend.map((d) => {
              const heightPct = (d.combinedKg / maxDayCombined) * 100;
              return (
                <div
                  key={d.date}
                  className="flex-1 flex flex-col items-center justify-end min-w-0 group"
                  title={`${d.date}\n${d.bills} bills, ${rs(d.revenue)}\nMilk: ${kg(d.milkKg)}, Yogurt: ${kg(d.yogurtKg)}`}
                >
                  <div
                    className="w-full rounded-t-sm bg-success/70 group-hover:bg-success transition-all"
                    style={{ height: `${Math.max(heightPct, 1)}%` }}
                  />
                </div>
              );
            })}
          </div>
          {dailyTrend.length > 0 && (
            <div className="flex justify-between text-[10px] text-text-secondary font-mono mt-2">
              <span>{dailyTrend[0]?.date}</span>
              <span>{dailyTrend[dailyTrend.length - 1]?.date}</span>
            </div>
          )}
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
