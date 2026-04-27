"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  cashRegisterService,
  customerService,
  productService,
  reportService,
  saleService,
} from "@/services/api";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  PackagePlus,
  Receipt,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  FileClock,
  CircleDollarSign,
  ShieldAlert,
} from "lucide-react";

function useCountUp(value: number, duration = 700) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let frame = 0;
    let mounted = true;
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const next = Math.round(value * progress);
      if (mounted) setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };

    setDisplay(0);
    frame = requestAnimationFrame(animate);
    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
    };
  }, [value, duration]);

  return display;
}

function MiniSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="mt-2 flex h-8 items-end gap-1">
      {values.map((value, idx) => (
        <span
          key={idx}
          className="flex-1 rounded-sm bg-primary/40"
          style={{ height: `${Math.max((value / max) * 100, 14)}%` }}
        />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ["reports", "daily-summary"],
    queryFn: () => reportService.getDailySummary(),
  });

  const { data: salesChart, isLoading: chartLoading } = useQuery<any>({
    queryKey: ["reports", "sales-chart", 7],
    queryFn: () => reportService.getSalesChart(7),
  });

  const { data: registerToday, isLoading: registerLoading } = useQuery<any>({
    queryKey: ["cash-register", "today"],
    queryFn: () => cashRegisterService.getToday(),
  });

  const { data: customers, isLoading: customersLoading } = useQuery<any>({
    queryKey: ["customers", "dashboard"],
    queryFn: () => customerService.getAll(),
  });

  const { data: lowStock, isLoading: lowStockLoading } = useQuery<any>({
    queryKey: ["inventory", "low-stock-dashboard"],
    queryFn: () => productService.getAll({ lowStock: true }),
  });

  const { data: sales, isLoading: salesLoading } = useQuery<any>({
    queryKey: ["sales", "dashboard-feed"],
    queryFn: () => saleService.getAll({ limit: 25 }),
  });

  const duesCount = useMemo(
    () => (customers ?? []).filter((c: any) => Number(c.currentBalance) > 0).length,
    [customers]
  );

  const todayRevenue = Number(summary?.totalSales || 0);
  const billsToday = Number(summary?.billsCount || 0);
  const cashOnHand = Number(registerToday?.cashIn || 0) - Number(registerToday?.cashOut || 0);
  const totalDues = Number(summary?.totalOutstanding || 0);

  const revenueAnimated = useCountUp(todayRevenue);
  const billsAnimated = useCountUp(billsToday);
  const cashAnimated = useCountUp(cashOnHand);
  const duesAnimated = useCountUp(totalDues);

  const weeklyValues = (salesChart ?? []).map((d: any) => Number(d.amount || 0));
  const weeklyMax = Math.max(...weeklyValues, 1);
  const weeklyTotal = weeklyValues.reduce((sum: number, value: number) => sum + value, 0);

  const activityFeed = (sales ?? []).slice(0, 12);
  const quickActions = [
    { href: "/pos", label: "New Sale", icon: ShoppingCart },
    { href: "/customers", label: "Add Customer", icon: UserPlus },
    { href: "/inventory", label: "Add Stock", icon: PackagePlus },
    { href: "/expenses", label: "Add Expense", icon: Wallet },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        breadcrumb="Home / Dashboard"
        description="Daily operations and performance snapshot"
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={CircleDollarSign}
          label="Today's Revenue"
          value={summaryLoading ? "..." : formatCurrency(revenueAnimated)}
          trend="+12% from yesterday"
          trendDirection="up"
          accent="success"
        >
          {!chartLoading && weeklyValues.length > 0 ? (
            <MiniSparkline values={weeklyValues} />
          ) : (
            <LoadingSkeleton className="h-8 w-24 rounded-sm" />
          )}
        </StatCard>

        <StatCard
          icon={Receipt}
          label="Bills Today"
          value={summaryLoading ? "..." : `${billsAnimated}`}
          trend={
            activityFeed.length > 0
              ? `Last bill: ${new Date(activityFeed[0].createdAt).toLocaleTimeString("en-PK", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "No bills yet"
          }
          trendDirection="neutral"
          accent="info"
        />

        <StatCard
          icon={Wallet}
          label="Cash on Hand"
          value={registerLoading ? "..." : formatCurrency(cashAnimated)}
          trend="After expenses"
          trendDirection="up"
          accent="primary"
        />

        <StatCard
          icon={ShieldAlert}
          label="Outstanding Dues"
          value={summaryLoading || customersLoading ? "..." : formatCurrency(duesAnimated)}
          trend={`${duesCount} customer${duesCount === 1 ? "" : "s"} owe`}
          trendDirection={totalDues > 0 ? "down" : "up"}
          accent={totalDues > 0 ? "danger" : "success"}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <article className="surface-card rounded-lg border border-border p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-text">Revenue This Week</h3>
              <p className="text-sm text-text-secondary">Total: {formatCurrency(weeklyTotal)}</p>
            </div>
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>

          {chartLoading ? (
            <div className="grid h-[260px] grid-cols-7 gap-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <LoadingSkeleton key={i} className="self-end h-full w-full rounded-md" />
              ))}
            </div>
          ) : (
            <div className="relative grid h-[260px] grid-cols-7 items-end gap-3 rounded-md border border-border bg-surface-2 p-3">
              {salesChart?.map((day: any) => {
                const amount = Number(day.amount || 0);
                const height = Math.max((amount / weeklyMax) * 100, 8);
                const isToday = Boolean(day.isToday);
                return (
                  <div key={day.label} className="group relative flex h-full flex-col justify-end">
                    <div
                      className={`relative rounded-t-md transition-all duration-200 ${
                        isToday
                          ? "bg-gradient-to-t from-accent to-accent-light"
                          : "bg-gradient-to-t from-primary to-primary-light"
                      }`}
                      style={{ height: `${height}%` }}
                    >
                      <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-[10px] text-text opacity-0 shadow-soft transition-opacity group-hover:opacity-100">
                        {formatCurrency(amount)}
                      </div>
                    </div>
                    <span className="mt-2 text-center text-[11px] text-text-secondary">{day.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="surface-card rounded-lg border border-border p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text">Today's Sales</h3>
            <FileClock className="h-5 w-5 text-info" />
          </div>
          {salesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <LoadingSkeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : activityFeed.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No sales yet"
              description="Sales activity will appear here in real time."
              className="min-h-[220px]"
            />
          ) : (
            <div className="hide-scrollbar max-h-[300px] space-y-2 overflow-y-auto pr-1">
              {activityFeed.slice(0, 8).map((sale: any) => (
                <div key={sale.id} className="rounded-md border border-border bg-surface-2 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-text-secondary">
                        {new Date(sale.createdAt).toLocaleTimeString("en-PK", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-sm font-medium text-text">{sale.customer?.name || "Walk-in Customer"}</p>
                    </div>
                    <p className="mono text-sm font-semibold text-accent">{formatCurrency(sale.grandTotal || 0)}</p>
                  </div>
                  <div className="mt-2">
                    <Badge
                      variant="outline"
                      className={
                        sale.paymentType === "CASH"
                          ? "border-success/40 bg-success/15 text-success"
                          : sale.paymentType === "CREDIT"
                          ? "border-danger/40 bg-danger/15 text-danger"
                          : "border-info/40 bg-info/15 text-info"
                      }
                    >
                      {sale.paymentType}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className="surface-card rounded-lg border border-border p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text">Top Products Today</h3>
            <Crown className="h-5 w-5 text-accent" />
          </div>
          {summaryLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <LoadingSkeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : (summary?.topProducts ?? []).length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No top products yet"
              description="Top selling items appear after sales are recorded."
              className="min-h-[220px]"
            />
          ) : (
            <div className="space-y-2">
              {summary.topProducts.slice(0, 5).map((item: any, index: number) => (
                <div key={item.id || item.name} className="flex items-center justify-between rounded-md border border-border bg-surface-2 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="mono inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-xs">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-text">{item.emoji || "🥛"} {item.name}</p>
                      <p className="text-xs text-text-secondary">
                        {item.qty || 0} {item.unit || "unit"}
                      </p>
                    </div>
                  </div>
                  <p className="mono text-sm font-semibold text-accent">{formatCurrency(item.revenue || 0)}</p>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="surface-card rounded-lg border border-border p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text">Low Stock Alerts</h3>
            <AlertTriangle className="h-5 w-5 text-warning" />
          </div>
          {lowStockLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <LoadingSkeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : (lowStock ?? []).length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All stocks healthy"
              description="No product is below threshold."
              className="min-h-[220px]"
            />
          ) : (
            <div className="space-y-2">
              {lowStock.slice(0, 5).map((product: any) => {
                const out = Number(product.stock) <= 0;
                return (
                  <div
                    key={product.id}
                    className={`rounded-md border p-2.5 ${
                      out ? "border-danger/50 bg-danger/10" : "border-warning/50 bg-warning/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-text">
                          {product.emoji || "📦"} {product.name}
                        </p>
                        <p className={`text-xs ${out ? "text-danger" : "text-warning"}`}>
                          {product.stock} {product.unit} left
                        </p>
                      </div>
                      <Button asChild size="sm" variant="outline" className="h-8">
                        <Link href="/inventory">Restock</Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="surface-card rounded-lg border border-border p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text">Quick Actions</h3>
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="interactive rounded-lg border border-border bg-surface-2 p-3"
              >
                <action.icon className="mb-2 h-5 w-5 text-primary" />
                <p className="text-sm font-medium text-text">{action.label}</p>
              </Link>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
