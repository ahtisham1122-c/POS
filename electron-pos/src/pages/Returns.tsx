import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw, Search, Undo2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "../lib/utils";

type SaleItem = {
  id: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  returned_quantity: number;
  returnable_quantity: number;
};

type ReturnDraft = Record<string, number>;

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

export default function Returns() {
  const [lookup, setLookup] = useState("");
  const [sale, setSale] = useState<any>(null);
  const [returnQty, setReturnQty] = useState<ReturnDraft>({});
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"CASH" | "CREDIT_ADJUSTMENT">("CASH");
  const [restockItems, setRestockItems] = useState(true);
  const [returns, setReturns] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pinModal, setPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const pinResolveRef = useRef<((pin: string | null) => void) | null>(null);

  const askPin = (): Promise<string | null> =>
    new Promise((resolve) => {
      pinResolveRef.current = resolve;
      setPinInput("");
      setPinModal(true);
    });

  const resolvePin = (pin: string | null) => {
    setPinModal(false);
    pinResolveRef.current?.(pin);
    pinResolveRef.current = null;
  };

  useEffect(() => {
    loadReturns();
  }, []);

  const selectedItems = useMemo(() => {
    const items: SaleItem[] = sale?.items || [];
    return items
      .map((item) => ({
        saleItemId: item.id,
        quantity: Number(returnQty[item.id] || 0),
        productName: item.product_name,
        unit: item.unit,
        lineTotal: Number(returnQty[item.id] || 0) * Number(item.unit_price || 0),
      }))
      .filter((item) => item.quantity > 0);
  }, [sale, returnQty]);

  const refundTotal = selectedItems.reduce((sum, item) => sum + item.lineTotal, 0);

  async function loadReturns() {
    const data = await window.electronAPI?.returns?.getAll();
    setReturns(data || []);
  }

  async function findSale() {
    setMessage(null);
    setSale(null);
    setReturnQty({});

    const cleanLookup = lookup.trim();
    if (!cleanLookup) {
      setMessage({ type: "error", text: "Enter a bill number like BILL-0001 first." });
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.electronAPI?.returns?.getSaleForReturn(cleanLookup);
      if (!result) {
        setMessage({ type: "error", text: "No sale found for this bill number." });
        return;
      }

      setSale(result);
      setRefundMethod(result.customer_id ? "CREDIT_ADJUSTMENT" : "CASH");
    } finally {
      setIsLoading(false);
    }
  }

  function setItemQty(item: SaleItem, value: string) {
    const raw = Number(value || 0);
    const safe = Math.max(0, Math.min(raw, Number(item.returnable_quantity || 0)));
    setReturnQty((current) => ({ ...current, [item.id]: safe }));
  }

  async function submitReturn() {
    setMessage(null);

    if (!sale) {
      setMessage({ type: "error", text: "Find a bill before creating a return." });
      return;
    }

    if (selectedItems.length === 0) {
      setMessage({ type: "error", text: "Enter return quantity for at least one item." });
      return;
    }

    if (!reason.trim()) {
      setMessage({ type: "error", text: "Write a short reason for this return." });
      return;
    }

    setIsSubmitting(true);
    try {
      const managerPin = await askPin();
      if (!managerPin) {
        setMessage({ type: "error", text: "Return blocked. Manager PIN is required." });
        setIsSubmitting(false);
        return;
      }
      const result = await window.electronAPI?.returns?.create({
        saleId: sale.id,
        items: selectedItems.map((item) => ({ saleItemId: item.saleItemId, quantity: item.quantity })),
        refundMethod,
        reason,
        restockItems,
        managerPin,
      });

      if (!result?.success) {
        setMessage({ type: "error", text: result?.error || "Return failed." });
        return;
      }

      setMessage({
        type: "success",
        text: `${result.returnNumber} completed. Refund amount: ${toMoney(result.refundAmount || 0)}.`,
      });
      setLookup("");
      setSale(null);
      setReturnQty({});
      setReason("");
      await loadReturns();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 animate-slide-up">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Returns & Refunds</h1>
          <p className="text-text-secondary mt-1">Reverse sold items safely with stock, cash, khata, and reports updated.</p>
        </div>
        <div className="card px-4 py-3 flex items-center gap-3 border-warning/30 bg-warning/5">
          <AlertTriangle className="w-5 h-5 text-warning" />
          <p className="text-sm text-text-secondary">Never delete old bills. Create a return so the audit trail stays clean.</p>
        </div>
      </div>

      {message && (
        <div className={cn(
          "rounded-xl border px-4 py-3 flex items-center gap-3",
          message.type === "success" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
        )}>
          {message.type === "success" ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          <span className="font-medium">{message.text}</span>
        </div>
      )}

      <div className="grid xl:grid-cols-[1.25fr_0.75fr] gap-6">
        <div className="card overflow-hidden">
          <div className="p-5 border-b border-surface-4 bg-surface-2/70">
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-primary" />
              Create Return
            </h2>
          </div>

          <div className="p-5 space-y-5">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                <input
                  value={lookup}
                  onChange={(event) => setLookup(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && findSale()}
                  className="input pl-10 h-12"
                  placeholder="Enter bill number, e.g. BILL-0001"
                />
              </div>
              <button onClick={findSale} disabled={isLoading} className="btn-primary h-12 min-w-36">
                {isLoading ? "Searching..." : "Find Bill"}
              </button>
            </div>

            {sale ? (
              <div className="space-y-5">
                <div className="grid sm:grid-cols-4 gap-3">
                  <div className="bg-surface-3 rounded-xl p-4 border border-surface-4">
                    <p className="text-xs text-text-secondary uppercase font-bold">Bill</p>
                    <p className="font-mono font-bold text-text-primary mt-1">{sale.bill_number}</p>
                  </div>
                  <div className="bg-surface-3 rounded-xl p-4 border border-surface-4">
                    <p className="text-xs text-text-secondary uppercase font-bold">Customer</p>
                    <p className="font-bold text-text-primary mt-1">{sale.customer_name}</p>
                  </div>
                  <div className="bg-surface-3 rounded-xl p-4 border border-surface-4">
                    <p className="text-xs text-text-secondary uppercase font-bold">Original Total</p>
                    <p className="font-mono font-bold text-text-primary mt-1">{toMoney(sale.grand_total)}</p>
                  </div>
                  <div className="bg-surface-3 rounded-xl p-4 border border-surface-4">
                    <p className="text-xs text-text-secondary uppercase font-bold">Status</p>
                    <p className="font-bold text-primary mt-1">{sale.status}</p>
                  </div>
                </div>

                <div className="overflow-x-auto border border-surface-4 rounded-xl">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface-3 border-b border-surface-4 text-text-secondary uppercase text-[10px] font-bold tracking-widest">
                      <tr>
                        <th className="px-4 py-3">Item</th>
                        <th className="px-4 py-3 text-right">Sold</th>
                        <th className="px-4 py-3 text-right">Already Returned</th>
                        <th className="px-4 py-3 text-right">Return Qty</th>
                        <th className="px-4 py-3 text-right">Refund</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-4">
                      {(sale.items as SaleItem[]).map((item) => {
                        const qty = Number(returnQty[item.id] || 0);
                        return (
                          <tr key={item.id} className={item.returnable_quantity <= 0 ? "opacity-50" : "hover:bg-surface-3/50"}>
                            <td className="px-4 py-3">
                              <p className="font-bold text-text-primary">{item.product_name}</p>
                              <p className="text-xs text-text-secondary">{toMoney(item.unit_price)} / {item.unit}</p>
                            </td>
                            <td className="px-4 py-3 text-right font-mono">{item.quantity} {item.unit}</td>
                            <td className="px-4 py-3 text-right font-mono text-warning">{item.returned_quantity} {item.unit}</td>
                            <td className="px-4 py-3 text-right">
                              <input
                                type="number"
                                min="0"
                                max={item.returnable_quantity}
                                step="0.01"
                                value={returnQty[item.id] || ""}
                                onChange={(event) => setItemQty(item, event.target.value)}
                                disabled={item.returnable_quantity <= 0}
                                className="input w-28 text-right"
                              />
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-accent">
                              {toMoney(qty * item.unit_price)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <label className="text-sm font-semibold text-text-primary">Refund Method</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setRefundMethod("CASH")}
                        className={cn("rounded-xl border px-4 py-3 font-bold transition-all", refundMethod === "CASH" ? "bg-primary text-white border-primary" : "border-surface-4 text-text-secondary hover:bg-surface-3")}
                      >
                        Cash Refund
                      </button>
                      <button
                        onClick={() => setRefundMethod("CREDIT_ADJUSTMENT")}
                        disabled={!sale.customer_id}
                        className={cn("rounded-xl border px-4 py-3 font-bold transition-all disabled:opacity-40", refundMethod === "CREDIT_ADJUSTMENT" ? "bg-warning text-black border-warning" : "border-surface-4 text-text-secondary hover:bg-surface-3")}
                      >
                        Reduce Khata
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-semibold text-text-primary">Stock Handling</label>
                    <button
                      onClick={() => setRestockItems(!restockItems)}
                      className={cn("w-full rounded-xl border px-4 py-3 text-left font-bold transition-all", restockItems ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning")}
                    >
                      {restockItems ? "Return items back to stock" : "Do not return items to stock"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-text-primary">Reason</label>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="input mt-2 min-h-24 resize-none"
                    placeholder="Example: Customer returned sour yogurt, wrong quantity, damaged packet..."
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-3 rounded-xl border border-surface-4 p-4">
                  <div>
                    <p className="text-xs text-text-secondary uppercase font-bold">Refund Total</p>
                    <p className="text-3xl font-mono font-bold text-accent">{toMoney(refundTotal)}</p>
                  </div>
                  <button
                    onClick={submitReturn}
                    disabled={isSubmitting || refundTotal <= 0}
                    className="btn-primary h-14 min-w-52 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Undo2 className="w-5 h-5" />
                    {isSubmitting ? "Processing..." : "Complete Return"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-surface-4 rounded-xl p-10 text-center text-text-secondary">
                <RotateCcw className="w-12 h-12 mx-auto opacity-40 mb-3" />
                <p className="font-bold text-text-primary">Find a bill to start a return</p>
                <p className="text-sm mt-1">Use the bill number printed on the receipt.</p>
              </div>
            )}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-5 border-b border-surface-4 bg-surface-2/70">
            <h2 className="text-lg font-bold text-text-primary">Recent Returns</h2>
          </div>
          <div className="divide-y divide-surface-4 max-h-[720px] overflow-y-auto">
            {returns.map((item) => (
              <div key={item.id} className="p-4 hover:bg-surface-3/40 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-text-primary">{item.return_number}</p>
                    <p className="text-xs text-text-secondary">{item.bill_number} - {item.customer_name}</p>
                    <p className="text-xs text-text-secondary mt-1">{format(new Date(item.return_date), "dd MMM yyyy, hh:mm a")}</p>
                  </div>
                  <span className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold",
                    item.refund_method === "CASH" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                  )}>
                    {item.refund_method === "CASH" ? "CASH" : "KHATA"}
                  </span>
                </div>
                <p className="mt-3 font-mono text-xl font-bold text-accent">{toMoney(item.refund_amount)}</p>
                <p className="text-xs text-text-secondary mt-1 line-clamp-2">{item.reason}</p>
              </div>
            ))}

            {returns.length === 0 && (
              <div className="p-10 text-center text-text-secondary">
                <p className="font-bold text-text-primary">No returns yet</p>
                <p className="text-sm mt-1">Returned bills will appear here.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {pinModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-xs overflow-hidden flex flex-col border border-surface-4 animate-slide-up">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-semibold text-lg">Manager PIN Required</h3>
              <button onClick={() => resolvePin(null)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-text-secondary text-center">Enter Manager PIN to approve this refund.</p>
              <input
                type="password"
                inputMode="numeric"
                value={pinInput}
                onChange={e => setPinInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && resolvePin(pinInput)}
                className="input font-mono text-2xl text-center tracking-widest py-4"
                placeholder="••••"
                autoFocus
              />
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => resolvePin(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => resolvePin(pinInput)} disabled={!pinInput} className="btn-primary flex-1">Approve</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
