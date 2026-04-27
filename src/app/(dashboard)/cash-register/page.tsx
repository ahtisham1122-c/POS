"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cashRegisterService } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Banknote, 
  ArrowDownCircle, 
  ArrowUpCircle, 
  Lock, 
  Unlock,
  AlertCircle,
  History,
  Loader2,
  Calendar
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

export default function CashRegisterPage() {
  const queryClient = useQueryClient();
  const [openingBalance, setOpeningBalance] = useState("");

  const { data: today, isLoading } = useQuery<any>({
    queryKey: ["cash-register", "today"],
    queryFn: () => cashRegisterService.getToday(),
  });

  const openMutation = useMutation({
    mutationFn: cashRegisterService.open,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-register"] });
      toast.success("Register opened for the day ✓");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const closeMutation = useMutation({
    mutationFn: cashRegisterService.close,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-register"] });
      toast.success("Register closed. Day finalized ✓");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const handleOpen = () => {
    if (!openingBalance) return;
    openMutation.mutate({ openingBalance: Number(openingBalance) });
  };

  const handleClose = () => {
    if (confirm("Are you sure you want to close the register? This will finalize today's totals.")) {
      closeMutation.mutate();
    }
  };

  if (isLoading) return <div className="h-64 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  const isClosed = today?.isClosedForDay;
  const isOpened = today && Number(today.openingBalance) > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-black font-poppins tracking-tight">Daily Cash Register</h1>
        <p className="text-gray-500 flex items-center justify-center gap-2">
            <Calendar className="w-4 h-4" /> {formatDate(new Date())}
        </p>
      </div>

      {!isOpened && !isClosed ? (
        <Card className="border-none shadow-xl bg-white overflow-hidden">
            <div className="bg-primary p-8 text-center text-white space-y-2">
                <Unlock className="w-12 h-12 mx-auto opacity-50" />
                <h2 className="text-2xl font-bold">Open Register</h2>
                <p className="text-primary-foreground/60 text-sm">Enter opening cash balance to start today's operations</p>
            </div>
            <CardContent className="p-8 space-y-6">
                <div className="max-w-xs mx-auto space-y-2">
                    <Label className="text-center block text-gray-400 uppercase text-[10px] font-bold tracking-widest">Opening Balance (Rs.)</Label>
                    <Input 
                        type="number" 
                        value={openingBalance}
                        onChange={(e) => setOpeningBalance(e.target.value)}
                        placeholder="0.00" 
                        className="h-16 text-3xl font-black text-center border-2 focus:border-primary"
                    />
                </div>
                <Button 
                    onClick={handleOpen}
                    className="w-full h-14 text-xl font-bold rounded-xl shadow-lg"
                    disabled={openMutation.isPending || !openingBalance}
                >
                    {openMutation.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : "START DAY"}
                </Button>
            </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
            {/* Status Banner */}
            {isClosed ? (
                <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex items-center gap-3 text-amber-700">
                    <Lock className="w-5 h-5 flex-shrink-0" />
                    <p className="text-sm font-medium">This register was closed at {new Date(today.closedAt).toLocaleTimeString()}. Operational totals are now finalized.</p>
                </div>
            ) : (
                <div className="bg-green-50 border border-green-100 p-4 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3 text-green-700">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <p className="text-sm font-bold">Register is currently active</p>
                    </div>
                </div>
            )}

            {/* Matrix */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-center">
                 <Card className="border-none shadow-sm h-40 flex flex-col justify-center">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Initial Opening Balance</p>
                    <h4 className="text-3xl font-black">{formatCurrency(today.openingBalance)}</h4>
                </Card>
                <Card className="border-none shadow-sm h-40 flex flex-col justify-center text-green-600 bg-green-50/20">
                    <p className="text-xs font-bold text-green-400 uppercase tracking-widest mb-2">Total Cash Influx</p>
                    <h4 className="text-3xl font-black">+{formatCurrency(today.cashIn)}</h4>
                </Card>
                <Card className="border-none shadow-sm h-40 flex flex-col justify-center text-red-600 bg-red-50/20">
                    <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-2">Total Cash Outflow</p>
                    <h4 className="text-3xl font-black">-{formatCurrency(today.cashOut)}</h4>
                </Card>
                <Card className="border-none shadow-sm h-40 flex flex-col justify-center bg-primary text-white">
                    <p className="text-xs font-bold text-white/50 uppercase tracking-widest mb-2">Expected In-Drawer Cash</p>
                    <h4 className="text-3xl font-black">
                        {formatCurrency(Number(today.openingBalance) + Number(today.cashIn) - Number(today.cashOut))}
                    </h4>
                </Card>
            </div>

            {!isClosed && (
                <div className="pt-8">
                     <Button 
                        onClick={handleClose} 
                        variant="destructive" 
                        size="lg" 
                        className="w-full h-16 text-xl font-bold shadow-xl flex items-center gap-3"
                        disabled={closeMutation.isPending}
                    >
                        {closeMutation.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <><Lock className="w-6 h-6" /> END DAY & CLOSE REGISTER</>}
                    </Button>
                    <p className="text-center text-xs text-gray-400 mt-4 italic">Note: Closing will calculate the final balance and lock today's ledger.</p>
                </div>
            )}
        </div>
      )}
    </div>
  );
}
