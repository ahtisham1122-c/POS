"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./EmptyState";
import { SkeletonTableRows } from "./LoadingSkeleton";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  accessor?: (row: T) => string | number | null | undefined;
  cell: (row: T, index: number) => React.ReactNode;
};

type SortState = {
  id: string;
  direction: "asc" | "desc";
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  rowsPerPageOptions?: number[];
  defaultRowsPerPage?: number;
};

export function DataTable<T>({
  columns,
  rows,
  loading = false,
  emptyTitle = "No data found",
  emptyDescription = "There is nothing to show right now.",
  rowsPerPageOptions = [10, 20, 50],
  defaultRowsPerPage = 10,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(defaultRowsPerPage);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;

    const col = columns.find((column) => column.id === sort.id);
    if (!col?.accessor) return rows;

    return [...rows].sort((a, b) => {
      const left = col.accessor?.(a);
      const right = col.accessor?.(b);

      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;

      if (typeof left === "number" && typeof right === "number") {
        return sort.direction === "asc" ? left - right : right - left;
      }

      const l = String(left).toLowerCase();
      const r = String(right).toLowerCase();
      if (l < r) return sort.direction === "asc" ? -1 : 1;
      if (l > r) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [columns, rows, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);

  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * rowsPerPage;
    return sortedRows.slice(start, start + rowsPerPage);
  }, [safePage, rowsPerPage, sortedRows]);

  const toggleSort = (column: DataTableColumn<T>) => {
    if (!column.sortable) return;
    setPage(1);
    setSort((prev) => {
      if (!prev || prev.id !== column.id) return { id: column.id, direction: "asc" };
      if (prev.direction === "asc") return { id: column.id, direction: "desc" };
      return null;
    });
  };

  const sortIcon = (column: DataTableColumn<T>) => {
    if (!column.sortable) return null;
    if (!sort || sort.id !== column.id) return <ArrowUpDown className="h-3.5 w-3.5 text-text-secondary" />;
    return sort.direction === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-primary" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-primary" />
    );
  };

  return (
    <div className="surface-card rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader className="bg-surface-2/60">
          <TableRow className="border-border">
            {columns.map((column) => (
              <TableHead
                key={column.id}
                className={cn(
                  "h-12 text-xs font-semibold uppercase tracking-wider text-text-secondary",
                  column.headerClassName
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(column)}
                  className={cn(
                    "inline-flex items-center gap-1.5",
                    column.sortable ? "cursor-pointer hover:text-text" : "cursor-default"
                  )}
                >
                  {column.header}
                  {sortIcon(column)}
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {loading ? (
            <SkeletonTableRows columns={columns.length} />
          ) : pagedRows.length === 0 ? (
            <TableRow className="border-0">
              <TableCell colSpan={columns.length} className="p-0">
                <EmptyState
                  icon={Database}
                  title={emptyTitle}
                  description={emptyDescription}
                  className="border-0 rounded-none min-h-[220px]"
                />
              </TableCell>
            </TableRow>
          ) : (
            pagedRows.map((row, rowIndex) => (
              <TableRow key={rowIndex} className="border-border hover:bg-surface-2/40">
                {columns.map((column) => (
                  <TableCell key={column.id} className={cn("text-sm text-text", column.className)}>
                    {column.cell(row, rowIndex)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-3 border-t border-border bg-surface-2/40 px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span>Rows per page:</span>
          <select
            value={rowsPerPage}
            onChange={(e) => {
              setRowsPerPage(Number(e.target.value));
              setPage(1);
            }}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text outline-none"
          >
            {rowsPerPageOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <span>
            {sortedRows.length === 0
              ? "0 results"
              : `${(safePage - 1) * rowsPerPage + 1} - ${Math.min(safePage * rowsPerPage, sortedRows.length)} of ${sortedRows.length}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={safePage <= 1}
          >
            Previous
          </Button>
          <span className="text-xs text-text-secondary">
            Page {safePage} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={safePage >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
