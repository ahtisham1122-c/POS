import { useState, useEffect } from "react";
import { Lock, Unlock, TrendingUp, TrendingDown, RefreshCw, AlertTriangle, Printer, Scale } from "lucide-react";
import { cn } from "../lib/utils";
import { format } from "date-fns";
import type { PageId } from "../App";

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function CashRegister({ setPage }: { setPage?: (page: PageId) => void }) {
  const [registerData, setRegisterData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [closingBalance, setClosingBalance] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenPin, setReopenPin] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [zReport, setZReport] = useState<any>(null);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [businessDate, setBusinessDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const loadRegister = async () => {
    try {
      setIsLoading(true);
      const data = await window.electronAPI?.cashRegister?.getToday();
      const shift = await window.electronAPI?.shifts?.getCurrent();
      const day = await window.electronAPI?.system?.getBusinessDate();
      setRegisterData(data);
      setCurrentShift(shift || null);
      if (day?.date) setBusinessDate(day.date);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const data = await window.electronAPI?.cashRegister?.getHistory();
      setHistory(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadZReport = async () => {
    try {
      const day = await window.electronAPI?.system?.getBusinessDate();
      const data = await window.electronAPI?.reports?.getZReport(day?.date || businessDate);
      setZReport(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadRegister();
    loadHistory();
    loadZReport();
  }, []);

  const handleOpenRegister = async () => {
    try {
      const existingShift = await window.electronAPI?.shifts?.getCurrent();
      let res = existingShift
        ? await window.electronAPI?.cashRegister?.open({ openingBalance: Number(openingBalance) })
        : await window.electronAPI?.shifts?.open({ openingCash: Number(openingBalance), notes: "Opened from cash register screen" });
      if (res?.requiresPreviousShiftConfirmation) {
        const proceed = window.confirm(res.error || "A shift from yesterday may still be open. Do you want to open a new shift?");
        if (!proceed) return;
        res = await window.electronAPI?.shifts?.open({
          openingCash: Number(openingBalance),
          notes: "Opened after midnight with confirmation",
          confirmAfterMidnightOpen: true
        });
      }
      if (res?.success) {
        loadRegister();
        loadHistory();
        loadZReport();
      } else {
        alert(res?.error || "Failed to open register");
      }
    } catch (err) {
      alert("Error opening register");
    }
  };

  const handleOpenShiftForExistingRegister = async () => {
    try {
      const res = await window.electronAPI?.shifts?.open({
        openingCash: Number(registerData?.opening_balance || 0),
        notes: "Shift opened for existing cash register"
      });
      if (res?.requiresPreviousShiftConfirmation) {
        const proceed = window.confirm(res.error || "A shift from yesterday may still be open. Do you want to open a new shift?");
        if (!proceed) return;
        const confirmed = await window.electronAPI?.shifts?.open({
          openingCash: Number(registerData?.opening_balance || 0),
          notes: "Shift opened for existing cash register after midnight with confirmation",
          confirmAfterMidnightOpen: true
        });
        if (confirmed?.success) {
          await loadRegister();
          alert("Shift opened. Sales can now be made.");
          return;
        }
        alert(confirmed?.error || "Failed to open shift");
        return;
      }
      if (res?.success) {
        await loadRegister();
        alert("Shift opened. Sales can now be made.");
        return;
      }
      alert(res?.error || "Failed to open shift");
    } catch (err: any) {
      alert(err?.message || "Error opening shift");
    }
  };

  const handleCloseRegister = async () => {
    try {
      const res = await window.electronAPI?.cashRegister?.close({
        closingBalance: Number(closingBalance),
        notes: closingNotes.trim()
      });
      if (res?.success) {
        setIsClosingModalOpen(false);
        setClosingNotes("");
        loadRegister();
        loadHistory();
        loadZReport();
      } else {
        alert(res?.error || "Failed to close register");
      }
    } catch (err) {
      alert("Error closing register");
    }
  };

  const handleReopenRegister = async () => {
    if (!reopenPin) return;
    try {
      const res = await window.electronAPI?.cashRegister?.reopen({ managerPin: reopenPin });
      if (res?.success) {
        setIsReopenModalOpen(false);
        setReopenPin("");
        loadRegister();
        loadHistory();
        loadZReport();
      } else {
        alert(res?.error || "Failed to reopen register");
      }
    } catch (err) {
      alert("Error reopening register");
    }
  };

  const exportZReport = async (formatType: "excel" | "pdf") => {
    const result = await window.electronAPI?.reports?.exportReport({
      type: "z-report",
      format: formatType,
      params: { date: businessDate }
    });
    if (!result?.success && result?.reason !== "canceled") alert(result?.error || "Export failed");
  };

  if (isLoading) {
    return <div className="p-6 flex justify-center"><RefreshCw className="w-8 h-8 animate-spin text-text-secondary" /></div>;
  }

  const currentExpectedCash = registerData 
    ? Number(registerData.opening_balance) + Number(registerData.cash_in) - Number(registerData.cash_out)
    : 0;
  const countedCash = Number(closingBalance || 0);
  const cashVariance = Number((countedCash - currentExpectedCash).toFixed(2));
  const varianceLabel = cashVariance === 0 ? "Cash matched" : cashVariance > 0 ? "Cash extra" : "Cash short";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto animate-slide-up">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Cash Register</h1>
          <p className="text-text-secondary mt-1">Manage drawer cash for shop day {businessDate}</p>
        </div>
        {registerData && !registerData.is_closed_for_day && (
          <button 
            onClick={() => {
              setClosingBalance(String(currentExpectedCash));
              setClosingNotes("");
              setIsClosingModalOpen(true);
            }}
            className="btn-primary bg-danger hover:bg-danger/90 flex items-center gap-2"
          >
            <Lock className="w-4 h-4" /> Close Register
          </button>
        )}
        {zReport && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => exportZReport("excel")} className="btn-secondary flex items-center gap-2">
              <Printer className="w-4 h-4" /> Excel
            </button>
            <button onClick={() => exportZReport("pdf")} className="btn-secondary flex items-center gap-2">
              <Printer className="w-4 h-4" /> PDF
            </button>
            <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2">
              <Printer className="w-4 h-4" /> Print Z-Report
            </button>
          </div>
        )}
      </div>

      {!registerData ? (
        <div className="card p-8 text-center max-w-md mx-auto mt-12 border-t-4 border-t-primary shadow-float">
          <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <Unlock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-text-primary">Open Shift & Register</h2>
          <p className="text-text-secondary mb-6 text-sm">Enter the opening cash balance in the drawer to start sales for today.</p>
          
          <div className="text-left mb-6">
            <label className="text-xs font-bold text-text-secondary uppercase mb-2 block">Opening Balance (Rs)</label>
            <input 
              type="number" 
              value={openingBalance}
              onChange={e => setOpeningBalance(e.target.value)}
              className="input text-3xl font-mono py-4 text-center text-success border-success/30 focus:border-success focus:ring-success"
              placeholder="0"
              autoFocus
            />
          </div>
          
          <button onClick={handleOpenRegister} className="btn-primary w-full h-12 text-lg shadow-glow">
            Start Day ✓
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {!currentShift && !registerData.is_closed_for_day && (
            <div className="card p-4 border border-danger/30 bg-danger/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 mt-0.5 text-danger" />
                <div>
                  <p className="font-bold text-text-primary">Shift is not open</p>
                  <p className="text-sm text-text-secondary">Sales are blocked until a shift is opened for accountability.</p>
                </div>
              </div>
              <button onClick={handleOpenShiftForExistingRegister} className="btn-primary flex items-center justify-center gap-2">
                Open Shift
              </button>
            </div>
          )}

          {!registerData.is_closed_for_day && (
            <div className="card p-4 border border-info/30 bg-info/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <Scale className="w-5 h-5 mt-0.5 text-info" />
                <div>
                  <p className="font-bold text-text-primary">Cash Count Audit</p>
                  <p className="text-sm text-text-secondary">At closing, count the real cash in the drawer. The app will show extra or short cash against expected sale cash.</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setClosingBalance(String(currentExpectedCash));
                  setClosingNotes("");
                  setIsClosingModalOpen(true);
                }}
                className="btn-secondary flex items-center justify-center gap-2"
              >
                <Scale className="w-4 h-4" />
                Count Cash
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card p-5 border-l-4 border-l-info">
              <p className="text-xs text-text-secondary font-bold uppercase tracking-wider mb-2">Opening Balance</p>
              <div className="text-2xl font-mono text-text-primary">{toMoney(registerData.opening_balance)}</div>
            </div>
            
            <div className="card p-5 border-l-4 border-l-success relative overflow-hidden">
              <TrendingUp className="absolute right-[-10px] top-1/2 -translate-y-1/2 w-24 h-24 text-success opacity-10" />
              <p className="text-xs text-text-secondary font-bold uppercase tracking-wider mb-2">Cash In (Sales/Khata)</p>
              <div className="text-2xl font-mono text-success font-bold">+{toMoney(registerData.cash_in)}</div>
            </div>

            <div className="card p-5 border-l-4 border-l-danger relative overflow-hidden">
              <TrendingDown className="absolute right-[-10px] top-1/2 -translate-y-1/2 w-24 h-24 text-danger opacity-10" />
              <p className="text-xs text-text-secondary font-bold uppercase tracking-wider mb-2">Cash Out (Expenses/Refunds)</p>
              <div className="text-2xl font-mono text-danger font-bold">-{toMoney(registerData.cash_out)}</div>
            </div>
          </div>

          <div className={cn("card p-6 flex flex-col items-center justify-center py-10", registerData.is_closed_for_day ? "bg-surface-3 opacity-80" : "bg-gradient-to-br from-surface-2 to-surface-3 border-t-4 border-t-success shadow-float")}>
            <p className="text-sm font-bold text-text-secondary uppercase tracking-widest mb-2">
              {registerData.is_closed_for_day ? "Final Closing Balance" : "Current Expected Cash"}
            </p>
            <div className="text-6xl font-black font-mono text-text-primary drop-shadow-md tracking-tight">
              {toMoney(registerData.is_closed_for_day ? registerData.closing_balance : currentExpectedCash)}
            </div>
            {registerData.is_closed_for_day && (
              <div className="flex flex-col items-center gap-3 mt-4">
                <div className="px-4 py-1.5 bg-danger/20 text-danger rounded-full text-xs font-bold flex items-center gap-2">
                  <Lock className="w-3 h-3" /> REGISTER CLOSED
                </div>
                <button
                  onClick={() => { setReopenPin(""); setIsReopenModalOpen(true); }}
                  className="flex items-center gap-2 text-sm text-warning hover:bg-warning/10 px-4 py-2 rounded-lg border border-warning/30 transition-colors font-medium"
                >
                  <Unlock className="w-4 h-4" /> Reopen Register
                </button>
              </div>
            )}
          </div>

          {zReport && (
            <div className="card overflow-hidden print-target">
              <div className="p-5 border-b border-surface-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-text-primary">Z-Report / End of Day Closing</h2>
                  <p className="text-sm text-text-secondary">Accountant-ready closing summary for {zReport.date}</p>
                </div>
                <span className={cn("px-3 py-1 rounded-full text-xs font-bold", zReport.status === "CLOSED" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                  {zReport.status}
                </span>
              </div>
              <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-surface-4">
                <div className="p-5 space-y-3">
                  {[
                    ["Cashier", zReport.cashierName],
                    ["Shift Open", zReport.shiftOpenTime ? format(new Date(zReport.shiftOpenTime), "dd MMM yyyy hh:mm a") : "-"],
                    ["Shift Close", zReport.shiftCloseTime ? format(new Date(zReport.shiftCloseTime), "dd MMM yyyy hh:mm a") : "-"],
                    ["Total Hours Open", `${Number(zReport.shiftHours || 0).toFixed(2)} hours`],
                    ["Bills Count", zReport.totalSalesCount],
                    ["Gross Sales", toMoney(zReport.grossSalesAmount)],
                    ["Discounts", `- ${toMoney(zReport.totalDiscounts)}`],
                    ["Refunds", `- ${toMoney(zReport.totalRefunds)}`],
                    ["Voids", `${zReport.totalVoids} bills`],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex justify-between gap-4 text-sm">
                      <span className="text-text-secondary">{label}</span>
                      <span className="font-mono font-bold text-text-primary text-right">{value}</span>
                    </div>
                  ))}
                </div>
                <div className="p-5 space-y-3">
                  {[
                    ["Opening Cash", toMoney(zReport.openingCash)],
                    ["Cash Sales", toMoney(zReport.cashSales)],
                    ["Online Sales", toMoney(zReport.onlineSales)],
                    ["Khata / Credit Sales", toMoney(zReport.khataCreditSales)],
                    ["Expenses", `- ${toMoney(zReport.expenses)}`],
                    ["Expected Cash", toMoney(zReport.netExpectedCashInDrawer)],
                    ["Counted Cash", zReport.status === "CLOSED" ? toMoney(zReport.cashActuallyCounted) : "Not closed"],
                    ["Variance", zReport.status === "CLOSED" ? toMoney(zReport.variance) : "Not closed"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex justify-between gap-4 text-sm">
                      <span className="text-text-secondary">{label}</span>
                      <span className={cn("font-mono font-bold text-right", label === "Variance" && Number(zReport.variance) !== 0 ? "text-danger" : "text-text-primary")}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CLOSE REGISTER MODAL */}
      {isClosingModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-lg overflow-hidden flex flex-col border border-surface-4">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center bg-surface-3">
              <h3 className="font-semibold text-lg flex items-center gap-2"><Scale className="w-5 h-5 text-primary" /> Count Cash & Close Register</h3>
              <button onClick={() => setIsClosingModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-3 p-4 rounded-lg text-center">
                  <p className="text-xs font-bold text-text-secondary uppercase">Expected Cash</p>
                  <p className="text-2xl font-mono font-bold text-text-primary">{toMoney(currentExpectedCash)}</p>
                </div>
                <div className={cn(
                  "p-4 rounded-lg text-center border",
                  cashVariance === 0 ? "bg-success/10 border-success/20" : cashVariance > 0 ? "bg-warning/10 border-warning/20" : "bg-danger/10 border-danger/20"
                )}>
                  <p className="text-xs font-bold text-text-secondary uppercase">{varianceLabel}</p>
                  <p className={cn("text-2xl font-mono font-bold", cashVariance === 0 ? "text-success" : cashVariance > 0 ? "text-warning" : "text-danger")}>
                    {cashVariance > 0 ? "+" : ""}{toMoney(cashVariance)}
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-md text-sm border border-info/20 bg-info/10 text-info">
                <p className="font-bold">How expected cash is calculated</p>
                <p className="text-xs opacity-90 mt-1">Opening cash + cash received from sales/khata - cash paid out for expenses/refunds/suppliers.</p>
              </div>

              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-2 block">Actual Counted Cash</label>
                <input 
                  type="number" 
                  value={closingBalance}
                  onChange={e => setClosingBalance(e.target.value)}
                  className="input text-3xl font-mono py-4 text-center text-danger border-danger/30 focus:border-danger focus:ring-danger"
                  placeholder="0"
                  autoFocus
                />
              </div>

              {Number(closingBalance) !== currentExpectedCash && (
                <div className={cn(
                  "p-3 border rounded-md text-sm text-center font-medium animate-slide-up",
                  cashVariance > 0 ? "bg-warning/10 border-warning/20 text-warning" : "bg-danger/10 border-danger/20 text-danger"
                )}>
                  {varianceLabel}: {cashVariance > 0 ? "+" : ""}{toMoney(cashVariance)}
                  <p className="text-xs opacity-80 mt-1">Add a short note if cash is extra or short.</p>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-2 block">Closing Note</label>
                <textarea
                  value={closingNotes}
                  onChange={e => setClosingNotes(e.target.value)}
                  className="input min-h-20 resize-none"
                  placeholder="Example: Rs. 50 short, cashier checked drawer..."
                />
              </div>
            </div>
            
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setIsClosingModalOpen(false)} className="btn-secondary flex-1 font-bold">Cancel</button>
              <button onClick={handleCloseRegister} className="btn-primary bg-danger hover:bg-danger/90 flex-1 font-bold">Confirm Close ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* REOPEN REGISTER MODAL */}
      {isReopenModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-sm overflow-hidden flex flex-col border border-warning/30">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center bg-warning/10">
              <h3 className="font-semibold text-lg flex items-center gap-2 text-warning">
                <Unlock className="w-5 h-5" /> Reopen Register
              </h3>
              <button onClick={() => setIsReopenModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-text-secondary">
                This will reopen today's closed register and restore the shift so sales can continue. Manager PIN is required.
              </p>
              <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 text-xs text-warning">
                ⚠ Only use this if the register was closed by mistake. The Z-Report will be voided until you close again properly.
              </div>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-2 block">Manager PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={reopenPin}
                  onChange={e => setReopenPin(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleReopenRegister()}
                  className="input font-mono text-2xl text-center tracking-widest py-4"
                  placeholder="••••"
                  autoFocus
                />
              </div>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setIsReopenModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={handleReopenRegister}
                disabled={!reopenPin}
                className="flex-1 bg-warning hover:bg-warning/80 text-black font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-40"
              >
                Reopen Register
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HISTORY SECTION */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2 mt-8">
          <TrendingUp className="w-5 h-5 text-text-secondary" /> Register History
        </h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-widest font-bold">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Opening</th>
                  <th className="px-4 py-3 text-right text-success">Cash In</th>
                  <th className="px-4 py-3 text-right text-danger">Cash Out</th>
                  <th className="px-4 py-3 text-right font-bold">Expected</th>
                  <th className="px-4 py-3 text-right font-bold text-primary">Actual</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-4">
                {history.map((h: any) => {
                  const expected = Number(h.opening_balance) + Number(h.cash_in) - Number(h.cash_out);
                  const variance = h.is_closed_for_day ? Number(h.closing_balance) - expected : 0;
                  return (
                    <tr key={h.id} className="hover:bg-surface-3/50 transition-colors">
                      <td className="px-4 py-3 font-mono">{h.date}</td>
                      <td className="px-4 py-3 text-right font-mono">{h.opening_balance.toFixed(0)}</td>
                      <td className="px-4 py-3 text-right font-mono text-success">+{h.cash_in.toFixed(0)}</td>
                      <td className="px-4 py-3 text-right font-mono text-danger">-{h.cash_out.toFixed(0)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold">{expected.toFixed(0)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-primary">{h.is_closed_for_day ? h.closing_balance.toFixed(0) : "—"}</td>
                      <td className={cn("px-4 py-3 text-right font-mono font-bold", variance === 0 ? "text-text-secondary" : variance > 0 ? "text-success" : "text-danger")}>
                        {h.is_closed_for_day ? (variance > 0 ? `+${variance.toFixed(0)}` : variance.toFixed(0)) : "Open"}
                      </td>
                    </tr>
                  );
                })}
                {history.length === 0 && (
                  <tr><td colSpan={7} className="text-center p-8 text-text-secondary">No register history found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
