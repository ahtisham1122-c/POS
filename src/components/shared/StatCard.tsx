"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type StatCardProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  accent?: "primary" | "success" | "warning" | "danger" | "info";
  className?: string;
  children?: React.ReactNode;
};

const accentMap: Record<NonNullable<StatCardProps["accent"]>, string> = {
  primary: "border-l-primary text-primary",
  success: "border-l-success text-success",
  warning: "border-l-warning text-warning",
  danger: "border-l-danger text-danger",
  info: "border-l-info text-info",
};

export function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  trendDirection = "neutral",
  accent = "primary",
  className,
  children,
}: StatCardProps) {
  return (
    <article
      className={cn(
        "surface-card interactive rounded-lg border border-border border-l-4 p-4",
        accentMap[accent],
        className
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-text-secondary">{label}</p>
          <p className="mono mt-1 text-2xl font-semibold text-text">{value}</p>
        </div>
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-2">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {(trend || children) && (
        <div className="mt-2 flex items-center justify-between">
          {trend ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                trendDirection === "up" && "text-success",
                trendDirection === "down" && "text-danger",
                trendDirection === "neutral" && "text-text-secondary"
              )}
            >
              {trendDirection === "up" && <ArrowUpRight className="h-3.5 w-3.5" />}
              {trendDirection === "down" && <ArrowDownRight className="h-3.5 w-3.5" />}
              {trend}
            </span>
          ) : (
            <span />
          )}
          {children}
        </div>
      )}
    </article>
  );
}
