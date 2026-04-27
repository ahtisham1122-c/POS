"use client";

import { cn } from "@/lib/utils";

type LoadingSkeletonProps = {
  className?: string;
};

export function LoadingSkeleton({ className }: LoadingSkeletonProps) {
  return <div className={cn("skeleton", className)} />;
}

type SkeletonTableRowsProps = {
  columns: number;
  rows?: number;
};

export function SkeletonTableRows({ columns, rows = 6 }: SkeletonTableRowsProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <tr key={index} className="border-b border-border">
          <td colSpan={columns} className="p-3">
            <LoadingSkeleton className="h-8 w-full rounded-md" />
          </td>
        </tr>
      ))}
    </>
  );
}
