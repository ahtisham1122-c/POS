"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customerService } from "@/services/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import { Search } from "lucide-react";
import { toast } from "sonner";

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);

  const { data: customers, isLoading } = useQuery<any>({
    queryKey: ["customers", "all", search],
    queryFn: () => customerService.getAll({ search }),
  });

  const outstanding = useMemo(
    () => (customers ?? []).reduce((sum: number, customer: any) => sum + Number(customer.currentBalance || 0), 0),
    [customers]
  );

  const openLedger = (customer: any) => {
    setSelectedCustomer(customer);
    setIsLedgerOpen(true);
  };

  const openPayment = (customer: any) => {
    setSelectedCustomer(customer);
    setIsPaymentOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Customers</p>
            <p className="mt-1 text-2xl font-semibold">{customers?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Outstanding</p>
            <p className="mt-1 text-2xl font-semibold text-danger">{formatCurrency(outstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Customers with Dues</p>
            <p className="mt-1 text-2xl font-semibold">{(customers ?? []).filter((c: any) => Number(c.currentBalance) > 0).length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" placeholder="Search customers" />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Current Balance</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <div className="h-8 animate-pulse rounded bg-surface" />
                  </TableCell>
                </TableRow>
              ))
            ) : (customers ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No customers found
                </TableCell>
              </TableRow>
            ) : (
              (customers ?? []).map((customer: any) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-semibold">{customer.name}</TableCell>
                  <TableCell>{customer.phone || "-"}</TableCell>
                  <TableCell className={cn("text-right font-mono", Number(customer.currentBalance) > 0 ? "text-danger" : "text-emerald-600")}>
                    {formatCurrency(customer.currentBalance)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openLedger(customer)}>
                        Open Ledger
                      </Button>
                      <Button size="sm" onClick={() => openPayment(customer)}>
                        Receive Payment
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <LedgerDialog customer={selectedCustomer} isOpen={isLedgerOpen} onClose={() => setIsLedgerOpen(false)} />
      <PaymentDialog
        customer={selectedCustomer}
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["customers"] });
          queryClient.invalidateQueries({ queryKey: ["reports"] });
        }}
      />
    </div>
  );
}

function LedgerDialog({ customer, isOpen, onClose }: any) {
  const { data: ledger, isLoading } = useQuery<any>({
    queryKey: ["customers", "ledger", customer?.id],
    queryFn: () => customerService.getLedger(customer.id),
    enabled: Boolean(customer?.id && isOpen),
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{customer?.name} Ledger Timeline</DialogTitle>
        </DialogHeader>
        <div className="max-h-[420px] space-y-2 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-surface" />)
          ) : (ledger ?? []).length === 0 ? (
            <div className="rounded border border-dashed p-5 text-center text-sm text-muted-foreground">
              No ledger activity yet
            </div>
          ) : (
            (ledger ?? []).map((entry: any) => (
              <div key={entry.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{entry.description}</p>
                  <p className={cn("font-mono text-sm", Number(entry.debit || 0) > 0 ? "text-danger" : "text-emerald-600")}>
                    {Number(entry.debit || 0) > 0 ? "+" : "-"}
                    {formatCurrency(entry.amount || 0)}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("en-PK")}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ customer, isOpen, onClose, onSuccess }: any) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: (payload: any) => customerService.collectPayment(customer.id, payload),
    onMutate: async (payload: any) => {
      await queryClient.cancelQueries({ queryKey: ["customers"] });
      const previousCustomers = queryClient.getQueryData(["customers", "all", ""]) as any;
      queryClient.setQueriesData({ queryKey: ["customers", "all"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((item: any) => {
          if (item.id !== customer.id) return item;
          return {
            ...item,
            currentBalance: Math.max(0, Number(item.currentBalance || 0) - Number(payload.amount || 0)),
          };
        });
      });
      return { previousCustomers };
    },
    onError: (error: any, _payload, context) => {
      if (context?.previousCustomers) {
        queryClient.setQueryData(["customers", "all", ""], context.previousCustomers);
      }
      toast.error(error.message || "Failed to collect payment");
    },
    onSuccess: () => {
      toast.success("Payment received");
      setAmount("");
      setNotes("");
      onClose();
      onSuccess?.();
    },
  });

  const handleSubmit = (e: any) => {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (numericAmount <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }
    mutation.mutate({
      amount: numericAmount,
      notes,
      date: new Date().toISOString(),
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Receive Payment</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg bg-primary/5 p-3 text-sm">
          Customer: <span className="font-semibold">{customer?.name || "-"}</span>
          <br />
          Current due: <span className="font-mono">{formatCurrency(customer?.currentBalance || 0)}</span>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Amount</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>Confirm</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
