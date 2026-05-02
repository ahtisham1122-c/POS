import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Lock, PlayCircle, RefreshCw, ShieldCheck, Scale } from "lucide-react";
import { format } from "date-fns";
import { cn } from "../lib/utils";
import type { PageId } from "../App";

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

export default function Shifts({ setPage }: { setPage?: (page: PageId) => void }) {
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [cashRegister, setCashRegister] = useState<any>(null);
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCash, setClosingCash] = useState("");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [businessDate, setBusinessDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const expectedCash = useMemo(() => {
    if (!cashRegister) return 0;
    return Number(cashRegister.opening_balance || 0) + Number(cashRegister.cash_in || 0) - Number(cashRegister.cash_out || 0);
  }, [cashRegister]);
  const todayDate = format(new Date(), "yyyy-MM-dd");
  const isPreviousDayShiftOpen = Boolean(currentShift && currentShift.shift_date !== todayDate);

  async function loadData() {
    setIsLoading(true);
    try {
      const day = await window.electronAPI?.system?.getBusinessDate();
      const activeDate = day?.date || businessDate;
      const [shift, shifts, register] = await Promise.all([
        window.electronAPI?.shifts?.getCurrent(),
        window.electronAPI?.shifts?.getHistory(30),
        window.electronAPI?.cashRegister?.getToday(),
      ]);
      setBusinessDate(activeDate);
      setCurrentShift(shift || null);
      setHistory(shifts || []);
      setCashRegister(register || null);
      if (register) setClosingCash(String(Number(register.opening_balance || 0) + Number(register.cash_in || 0) - Number(register.cash_out || 0)));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function openShift(confirmAfterMidnightOpen = false) {
    setMessage(null);
    const result = await window.electronAPI?.shifts?.open({
      openingCash: Number(openingCash || 0),
      notes,
      confirmAfterMidnightOpen,
    });
    if (!result?.success) {
      // Backend asks for explicit confirmation before opening another shift
      // in the same calendar day before sunrise. Ask the user and retry.
      if (result?.requiresPreviousShiftConfirmation) {
        const proceed = window.confirm(
          (result?.error || "A previous shift may still need attention.") +
          "\n\nClick OK to open a new shift now."
        );
        if (proceed) {
          await openShift(true);
        }
        return;
      }
      setMessage({ type: "error", text: result?.error || "Failed to open shift." });
      return;
    }
    setMessage({ type: "success", text: "Shift opened successfully." });
    setNotes("");
    await loadData();
  }

  async function closeShift() {
    setMessage(null);
    const result = await window.electronAPI?.shifts?.close({ closingCash: Number(closingCash || 0), notes });
    if (!result?.success) {
      setMessage({ type: "error", text: result?.error || "Failed to close shift." });
      return;
    }
    setMessage({ type: "success", text: `Shift closed. Difference: ${toMoney(result.variance || 0)}. You can now open today's shift.` });
    setNotes("");
    await loadData();
  }

  if (isLoading) {
    return <div className="p-6 flex justify-center"><RefreshCw className="w-8 h-8 animate-spin text-text-secondary" /></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Shift Management</h1>
          <p className="text-text-secondary mt-1">Track who opened, who closed, expected cash, counted cash, and cash difference for shop day {businessDate}.</p>
        </div>
        <button onClick={loadData} className="btn-secondary flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {message && (
        <div className={cn(
          "rounded-xl border px-4 py-3 flex items-center gap-3",
          message.type === "success" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
        )}>
          {message.type === "success" ? <ShieldCheck className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          <span className="font-medium">{message.text}</span>
        </div>
      )}

      <div className="grid xl:grid-cols-[0.9fr_1.1fr] gap-6">
        <div className="card overflow-hidden">
          <div className="p-5 border-b border-surface-4 bg-surface-2/70">
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              {currentShift ? <Clock className="w-5 h-5 text-success" /> : <PlayCircle className="w-5 h-5 text-primary" />}
              {currentShift ? "Current Open Shift" : "Open New Shift"}
            </h2>
          </div>

          <div className="p-5 space-y-5">
            {currentShift ? (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <InfoCard label="Shift Date" value={currentShift.shift_date} tone={isPreviousDayShiftOpen ? "warning" : "default"} />
                  <InfoCard label="Opened By" value={currentShift.opened_by_name || currentShift.opened_by_id} />
                  <InfoCard label="Opened At" value={format(new Date(currentShift.opened_at), "dd MMM, hh:mm a")} />
                  <InfoCard label="Opening Cash" value={toMoney(currentShift.opening_cash)} />
                  <InfoCard label="Expected Cash" value={toMoney(expectedCash)} tone="success" />
                </div>

                {isPreviousDayShiftOpen && (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
                    <div>
                      <p className="font-bold text-warning">Previous shift is still open</p>
                      <p className="text-sm text-text-secondary mt-1">
                        This shift is from {currentShift.shift_date}. Count the cash drawer, enter the counted cash below, close this shift, then open today's shift.
                      </p>
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-info/30 bg-info/5 p-4">
                  <p className="font-bold text-text-primary flex items-center gap-2">
                    <Scale className="w-4 h-4 text-info" />
                    Cash Count Audit
                  </p>
                  <p className="text-sm text-text-secondary mt-1">
                    Count the drawer cash below. The app compares your counted cash with expected cash and records the difference.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-semibold text-text-primary">Closing Cash Count</label>
                  <input
                    value={closingCash}
                    onChange={(event) => setClosingCash(event.target.value)}
                    type="number"
                    className="input mt-2 text-3xl font-mono text-center"
                  />
                  <p className={cn("text-sm mt-2 font-bold", Number(closingCash || 0) - expectedCash === 0 ? "text-success" : "text-danger")}>
                    Difference: {toMoney(Number(closingCash || 0) - expectedCash)}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-semibold text-text-primary">Close Notes</label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="input mt-2 min-h-24 resize-none"
                    placeholder="Explain any cash or receipt difference..."
                  />
                </div>

                <button onClick={closeShift} className="btn-primary bg-danger hover:bg-danger/90 w-full h-14 flex items-center justify-center gap-2">
                  <Lock className="w-5 h-5" />
                  Close Shift
                </button>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
                  <p className="font-bold text-primary">Start accountability for the day</p>
                  <p className="text-sm text-text-secondary mt-1">Opening a shift also opens today's cash register if it is not already open.</p>
                </div>

                <div>
                  <label className="text-sm font-semibold text-text-primary">Opening Cash</label>
                  <input
                    value={openingCash}
                    onChange={(event) => setOpeningCash(event.target.value)}
                    type="number"
                    className="input mt-2 text-3xl font-mono text-center"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-text-primary">Opening Notes</label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="input mt-2 min-h-24 resize-none"
                    placeholder="Example: Morning shift opened by cashier..."
                  />
                </div>

                <button onClick={() => openShift()} className="btn-primary w-full h-14 flex items-center justify-center gap-2">
                  <PlayCircle className="w-5 h-5" />
                  Open Shift
                </button>
              </>
            )}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-5 border-b border-surface-4 bg-surface-2/70">
            <h2 className="text-lg font-bold text-text-primary">Shift History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-widest font-bold">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Opened By</th>
                  <th className="px-4 py-3">Closed By</th>
                  <th className="px-4 py-3 text-right">Opening</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Closing</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-4">
                {history.map((shift) => (
                  <tr key={shift.id} className="hover:bg-surface-3/50 transition-colors">
                    <td className="px-4 py-3 font-mono">{shift.shift_date}</td>
                    <td className="px-4 py-3">{shift.opened_by_name || shift.opened_by_id}</td>
                    <td className="px-4 py-3">{shift.closed_by_name || "Open"}</td>
                    <td className="px-4 py-3 text-right font-mono">{toMoney(shift.opening_cash)}</td>
                    <td className="px-4 py-3 text-right font-mono">{toMoney(shift.expected_cash)}</td>
                    <td className="px-4 py-3 text-right font-mono">{shift.status === "CLOSED" ? toMoney(shift.closing_cash) : "Open"}</td>
                    <td className={cn("px-4 py-3 text-right font-mono font-bold", Number(shift.cash_variance || 0) === 0 ? "text-text-secondary" : Number(shift.cash_variance || 0) > 0 ? "text-warning" : "text-danger")}>
                      {shift.status === "CLOSED" ? toMoney(shift.cash_variance) : "Open"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "px-2 py-1 rounded-md text-[10px] font-bold",
                        shift.status === "OPEN" ? "bg-success/10 text-success" : "bg-surface-4 text-text-secondary"
                      )}>
                        {shift.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-text-secondary">No shifts found yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "default" }) {
  return (
    <div className="bg-surface-3 rounded-xl p-4 border border-surface-4">
      <p className="text-xs text-text-secondary uppercase font-bold">{label}</p>
      <p className={cn(
        "font-bold text-text-primary mt-1",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning"
      )}>{value}</p>
    </div>
  );
}
