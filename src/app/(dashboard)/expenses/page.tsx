"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { expenseService, reportService } from "@/services/api";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Wallet, 
  Plus, 
  History, 
  Filter,
  Trash2,
  Loader2,
  CalendarDays
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { useState } from "react";

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("TODAY");

  // Queries
  const { data: expenses, isLoading } = useQuery<any>({
    queryKey: ["expenses", "all", activeTab],
    queryFn: () => expenseService.getAll({ range: activeTab }),
  });

  const { data: summary } = useQuery<any>({
    queryKey: ["expenses", "summary"],
    queryFn: () => reportService.getDailySummary(), // We can use daily summary for expense count too
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: expenseService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Expense recorded ✓");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const handleSubmit = (e: any) => {
    e.preventDefault();
    const f = new FormData(e.target);
    createMutation.mutate({
      expenseDate: f.get("date"),
      category: f.get("category"),
      description: f.get("description"),
      amount: Number(f.get("amount")),
    });
    e.target.reset();
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-poppins tracking-tight">Expense Tracker</h1>
          <p className="text-sm text-gray-500">Record and monitor all operational expenses</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Quick Form */}
        <Card className="lg:col-span-1 border-none shadow-sm h-fit sticky top-24">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" /> New Expense
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
               <div className="space-y-1.5">
                  <Label>Date</Label>
                  <Input type="date" name="date" required defaultValue={new Date().toISOString().split('T')[0]} />
               </div>
               <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select name="category" required defaultValue="MISCELLANEOUS">
                    <SelectTrigger className="bg-surface border-none h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="MILK_PURCHASE">Milk Purchase</SelectItem>
                        <SelectItem value="SALARY">Salary</SelectItem>
                        <SelectItem value="ELECTRICITY">Electricity</SelectItem>
                        <SelectItem value="FUEL">Fuel</SelectItem>
                        <SelectItem value="PACKAGING">Packaging</SelectItem>
                        <SelectItem value="RENT">Rent</SelectItem>
                        <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                        <SelectItem value="MISCELLANEOUS">Miscellaneous</SelectItem>
                    </SelectContent>
                  </Select>
               </div>
               <div className="space-y-1.5">
                  <Label>Amount (Rs.)</Label>
                  <Input type="number" name="amount" step="0.01" required placeholder="0.00" className="h-11 font-bold" />
               </div>
               <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Input name="description" required placeholder="Reason for expense..." className="h-11" />
               </div>
               <Button type="submit" className="w-full h-12 text-lg" disabled={createMutation.isPending}>
                 {createMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save Expense"}
               </Button>
            </form>
          </CardContent>
        </Card>

        {/* Right: History */}
        <div className="lg:col-span-3 space-y-6">
            <div className="flex items-center gap-4 bg-white p-1 rounded-xl shadow-sm border w-fit">
               <Button 
                variant={activeTab === "TODAY" ? "default" : "ghost"} 
                size="sm" 
                onClick={() => setActiveTab("TODAY")}
                className="h-9 px-4 text-xs font-bold"
               >Today</Button>
               <Button 
                variant={activeTab === "WEEK" ? "default" : "ghost"} 
                size="sm" 
                onClick={() => setActiveTab("WEEK")}
                className="h-9 px-4 text-xs font-bold"
               >This Week</Button>
               <Button 
                variant={activeTab === "MONTH" ? "default" : "ghost"} 
                size="sm" 
                onClick={() => setActiveTab("MONTH")}
                className="h-9 px-4 text-xs font-bold"
               >This Month</Button>
            </div>

            <Card className="border-none shadow-sm overflow-hidden">
                <Table>
                    <TableHeader className="bg-surface/50 border-b">
                        <TableRow>
                            <TableHead className="w-[120px]">Date</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-center w-[80px]">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <TableRow key={i}><TableCell colSpan={5}><div className="h-10 bg-gray-50 animate-pulse rounded" /></TableCell></TableRow>
                            ))
                        ) : expenses?.length === 0 ? (
                            <TableRow><TableCell colSpan={5} className="h-40 text-center text-gray-400">No expenses recorded for this period</TableCell></TableRow>
                        ) : expenses?.map((e: any) => (
                            <TableRow key={e.id} className="hover:bg-surface/30">
                                <TableCell className="text-xs font-medium">{formatDate(e.expenseDate)}</TableCell>
                                <TableCell><Badge variant="secondary" className="text-[10px] uppercase font-bold">{e.category.replace('_', ' ')}</Badge></TableCell>
                                <TableCell className="text-sm">{e.description}</TableCell>
                                <TableCell className="text-right font-bold text-danger">{formatCurrency(e.amount)}</TableCell>
                                <TableCell className="text-center">
                                     <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-300 hover:text-danger"><Trash2 className="w-4 h-4" /></Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>
        </div>
      </div>
    </div>
  );
}
