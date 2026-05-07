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
  generatedAt: string;
};

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
          {/* Y-axis peak indicator + chart canvas. Days with zero combinedKg
              still render a 1-px bar so the chart shows the full series. */}
          <div className="relative h-44 ml-12">
            <div className="absolute -left-12 top-0 text-[10px] font-mono text-text-secondary">
              {kg(maxDayCombined)}
            </div>
            <div className="absolute -left-12 bottom-0 text-[10px] font-mono text-text-secondary">0 kg</div>
            <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-surface-4" />
            <div className="absolute -left-12 top-1/2 -translate-y-1/2 text-[10px] font-mono text-text-secondary">
              {kg(maxDayCombined / 2)}
            </div>
            <div className="flex items-end gap-[2px] h-full">
              {dailyTrend.length === 0 && (
                <div className="text-text-secondary text-sm w-full text-center py-10">
                  Not enough sales data yet — need at least 1 day of sales.
                </div>
              )}
              {dailyTrend.map((d) => {
                const heightPct = (d.combinedKg / maxDayCombined) * 100;
                const hasSales = d.combinedKg > 0;
                return (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col items-center justify-end min-w-0 group relative"
                    title={`${formatChartDate(d.date)}\n${d.bills} bills, ${rs(d.revenue)}\nMilk: ${kg(d.milkKg)}  ·  Yogurt: ${kg(d.yogurtKg)}`}
                  >
                    <div
                      className={cn(
                        "w-full rounded-t-sm transition-all",
                        hasSales
                          ? "bg-success/70 group-hover:bg-success"
                          : "bg-surface-3 group-hover:bg-surface-4"
                      )}
                      style={{ height: `${hasSales ? Math.max(heightPct, 2) : 1}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          {/* X-axis: print a date label every Nth bar so labels don't overlap */}
          {dailyTrend.length > 0 && (
            <div className="ml-12 flex gap-[2px] mt-2">
              {dailyTrend.map((d, idx) => {
                const stride = Math.max(1, Math.ceil(dailyTrend.length / 8));
                const showLabel = idx === 0 || idx === dailyTrend.length - 1 || idx % stride === 0;
                return (
                  <div
                    key={d.date}
                    className="flex-1 text-[9px] text-text-secondary font-mono text-center min-w-0 truncate"
                  >
                    {showLabel ? formatChartDateShort(d.date) : ""}
                  </div>
                );
              })}
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
