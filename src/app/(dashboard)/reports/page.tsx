"use client";

import { useQuery } from "@tanstack/react-query";
import { reportService, saleService } from "@/services/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";

export default function ReportsPage() {
  const { data: sales, isLoading: isSalesLoading } = useQuery<any>({
    queryKey: ["sales", "all"],
    queryFn: () => saleService.getAll(),
  });

  const { data: dailySummary, isLoading: isSummaryLoading } = useQuery<any>({
    queryKey: ["reports", "daily-summary"],
    queryFn: () => reportService.getDailySummary(),
  });

  const { data: productStats, isLoading: isProductStatsLoading } = useQuery<any>({
    queryKey: ["reports", "product-performance"],
    queryFn: () => reportService.getProductPerformance(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-poppins tracking-tight">Business Reports</h1>
          <p className="text-sm text-muted-foreground">Operational and financial visibility in one place</p>
        </div>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      <Tabs defaultValue="history" className="space-y-4">
        <TabsList className="border bg-white">
          <TabsTrigger value="history">Sales History</TabsTrigger>
          <TabsTrigger value="daily">Daily Summary</TabsTrigger>
          <TabsTrigger value="products">Product Stats</TabsTrigger>
          <TabsTrigger value="dues">Outstanding Dues</TabsTrigger>
        </TabsList>

        <TabsContent value="history">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill No</TableHead>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Grand Total</TableHead>
                  <TableHead className="text-center">Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isSalesLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <div className="h-8 animate-pulse rounded bg-surface" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (sales ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No sales recorded yet
                    </TableCell>
                  </TableRow>
                ) : (
                  (sales ?? []).map((sale: any) => (
                    <TableRow key={sale.id}>
                      <TableCell className="font-mono text-xs">{sale.billNumber}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(sale.createdAt)}</TableCell>
                      <TableCell>{sale.customer?.name || "Walk-in"}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(sale.discountAmount || 0)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold text-primary">
                        {formatCurrency(sale.grandTotal || 0)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] uppercase",
                            sale.paymentType === "CASH" && "bg-emerald-50 text-emerald-700",
                            sale.paymentType === "CREDIT" && "bg-red-50 text-red-700",
                            sale.paymentType === "PARTIAL" && "bg-amber-50 text-amber-700"
                          )}
                        >
                          {sale.paymentType}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="daily">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <SummaryCard label="Today Sales" value={formatCurrency(dailySummary?.totalSales || 0)} loading={isSummaryLoading} />
            <SummaryCard label="Bills Count" value={String(dailySummary?.billsCount || 0)} loading={isSummaryLoading} />
            <SummaryCard label="Total Expenses" value={formatCurrency(dailySummary?.totalExpenses || 0)} loading={isSummaryLoading} />
            <SummaryCard label="Total Outstanding" value={formatCurrency(dailySummary?.totalOutstanding || 0)} loading={isSummaryLoading} />
          </div>
        </TabsContent>

        <TabsContent value="products">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isProductStatsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={3}>
                        <div className="h-8 animate-pulse rounded bg-surface" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (productStats ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                      No product sales data found
                    </TableCell>
                  </TableRow>
                ) : (
                  (productStats ?? []).map((item: any) => (
                    <TableRow key={item.productId || item.id}>
                      <TableCell className="font-medium">{item.productName || item.name}</TableCell>
                      <TableCell className="text-right font-mono">{item.totalQty || item.qty || 0}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(item.totalRevenue || item.revenue || 0)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="dues">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(dailySummary?.dueCustomers ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                      No outstanding dues
                    </TableCell>
                  </TableRow>
                ) : (
                  (dailySummary?.dueCustomers ?? []).map((customer: any) => (
                    <TableRow key={customer.id}>
                      <TableCell>{customer.name}</TableCell>
                      <TableCell>{customer.phone || "-"}</TableCell>
                      <TableCell className="text-right font-mono text-danger">
                        {formatCurrency(customer.currentBalance || 0)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <div className="h-8 w-32 animate-pulse rounded bg-surface" /> : <p className="font-mono text-2xl font-semibold">{value}</p>}
      </CardContent>
    </Card>
  );
}
