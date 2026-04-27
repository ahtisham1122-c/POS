"use client";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  breadcrumb?: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  breadcrumb,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 md:flex-row md:items-center md:justify-between", className)}>
      <div className="min-w-0">
        {breadcrumb && (
          <p className="mb-1 truncate text-xs uppercase tracking-wider text-text-secondary">
            {breadcrumb}
          </p>
        )}
        <h1 className="truncate text-2xl font-semibold text-text">{title}</h1>
        {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
