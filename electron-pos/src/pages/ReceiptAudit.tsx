import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, CopyCheck, FileWarning, Save } from "lucide-react";
import { cn } from "../lib/utils";

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function parseReceiptInput(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function ReceiptAudit() {
  const [date, setDate] = useState(today());
  const [receiptText, setReceiptText] = useState("");
  const [notes, setNotes] = useState("");
  const [audit, setAudit] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const billNumbers = useMemo(() => parseReceiptInput(receiptText), [receiptText]);

  useEffect(() => {
    loadBusinessDate();
    loadHistory();
  }, []);

  async function loadBusinessDate() {
    const day = await window.electronAPI?.system?.getBusinessDate();
    if (day?.date) setDate(day.date);
  }

  async function loadHistory() {
    const data = await window.electronAPI?.receiptAudit?.getHistory(20);
    setHistory(data || []);
  }

  async function previewAudit() {
    setMessage(null);
    setIsLoading(true);
    try {
      const result = await window.electronAPI?.receiptAudit?.preview({ date, billNumbers });
      if (!result?.success) {
        setMessage({ type: "error", text: result?.error || "Audit preview failed." });
        return;
      }
      setAudit(result.audit);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveAudit() {
    setMessage(null);
    setIsLoading(true);
    try {
      const result = await window.electronAPI?.receiptAudit?.save({ date, billNumbers, notes });
      if (!result?.success) {
        setMessage({ type: "error", text: result?.error || "Audit save failed." });
        return;
      }
      setAudit(result.audit);
      setMessage({ type: "success", text: "Receipt audit saved successfully." });
      await loadHistory();
    } finally {
      setIsLoading(false);
    }
  }

  const hasProblem = audit && (audit.missingCount > 0 || audit.extraCount > 0 || audit.duplicateCount > 0);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 animate-slide-up">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Receipt Audit</h1>
          <p className="text-text-secondary mt-1">
            At closing, count the receipts kept by the item counter and compare them with POS bills.
          </p>
        </div>
        <div className="card px-4 py-3 border-warning/30 bg-warning/5 max-w-xl">
          <p className="text-sm text-text-secondary">
            Pakistan shop rule: customer gives receipt to item counter, item counter keeps it. If the paper receipt is returned, the same customer may try to claim items again.
          </p>
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

      <div className="grid xl:grid-cols-[1.15fr_0.85fr] gap-6">
        <div className="card overflow-hidden">
          <div className="p-5 border-b border-surface-4 bg-surface-2/70 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-primary" />
                Closing Receipt Count
              </h2>
              <p className="text-sm text-text-secondary mt-1">Type or paste bill numbers from the physical receipt pile.</p>
            </div>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="input w-44"
            />
          </div>

          <div className="p-5 space-y-5">
            <div>
              <label className="text-sm font-semibold text-text-primary">Collected Receipt Numbers</label>
              <textarea
                value={receiptText}
                onChange={(event) => setReceiptText(event.target.value)}
                className="input mt-2 min-h-56 resize-y font-mono text-sm"
                placeholder={"Example:\nBILL-0001\nBILL-0002\nBILL-0003"}
              />
              <p className="text-xs text-text-secondary mt-2">
                You entered {billNumbers.length} receipt number{billNumbers.length === 1 ? "" : "s"}. Separate by new line, comma, or space.
              </p>
            </div>

            <div>
              <label className="text-sm font-semibold text-text-primary">Audit Notes</label>
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="input mt-2"
                placeholder="Example: One receipt missing, checked with delivery staff..."
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={previewAudit} disabled={isLoading} className="btn-secondary h-12 flex-1 flex items-center justify-center gap-2">
                <CopyCheck className="w-5 h-5" />
                {isLoading ? "Checking..." : "Preview Audit"}
              </button>
              <button onClick={saveAudit} disabled={isLoading || !audit} className="btn-primary h-12 flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
                <Save className="w-5 h-5" />
                Save Audit
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className={cn("card p-5 border-t-4", !audit ? "border-t-surface-4" : hasProblem ? "border-t-danger" : "border-t-success")}>
            <h2 className="text-lg font-bold text-text-primary mb-4">Audit Result</h2>
            {!audit ? (
              <div className="text-center text-text-secondary py-12">
                <FileWarning className="w-12 h-12 mx-auto opacity-40 mb-3" />
                <p className="font-bold text-text-primary">No audit preview yet</p>
                <p className="text-sm mt-1">Enter receipts and click Preview Audit.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface-3 rounded-xl p-4 border border-surface-4">
                    <p className="text-xs text-text-secondary uppercase font-bold">POS Bills</p>
                    <p className="text-2xl font-mono font-bold text-text-primary">{audit.expectedCount}</p>
                    <p className="text-xs text-text-secondary">{toMoney(audit.expectedAmount)}</p>
                  </div>
                  <div className="bg-surface-3 rounded-xl p-4 border border-surface-4">
                    <p className="text-xs text-text-secondary uppercase font-bold">Receipts Found</p>
                    <p className="text-2xl font-mono font-bold text-success">{audit.countedCount}</p>
                    <p className="text-xs text-text-secondary">{toMoney(audit.countedAmount)}</p>
                  </div>
                  <div className="bg-danger/10 rounded-xl p-4 border border-danger/30">
                    <p className="text-xs text-danger uppercase font-bold">Missing</p>
                    <p className="text-2xl font-mono font-bold text-danger">{audit.missingCount}</p>
                    <p className="text-xs text-danger/80">{toMoney(audit.missingAmount)}</p>
                  </div>
                  <div className="bg-warning/10 rounded-xl p-4 border border-warning/30">
                    <p className="text-xs text-warning uppercase font-bold">Extra / Duplicate</p>
                    <p className="text-2xl font-mono font-bold text-warning">{audit.extraCount + audit.duplicateCount}</p>
                    <p className="text-xs text-warning/80">{audit.extraCount} extra, {audit.duplicateCount} duplicate</p>
                  </div>
                </div>

                <div className={cn("rounded-xl px-4 py-3 border", hasProblem ? "bg-danger/10 border-danger/30 text-danger" : "bg-success/10 border-success/30 text-success")}>
                  <p className="font-bold">{hasProblem ? "Audit needs checking" : "Audit matched perfectly"}</p>
                  <p className="text-sm opacity-90">
                    Difference between POS sales and physical receipts: {toMoney(audit.differenceAmount)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-surface-4 bg-surface-2/70">
              <h2 className="font-bold text-text-primary">Previous Audits</h2>
            </div>
            <div className="divide-y divide-surface-4 max-h-72 overflow-y-auto">
              {history.map((entry) => (
                <div key={entry.id} className="p-4 hover:bg-surface-3/40 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-text-primary">{entry.audit_date}</p>
                      <p className="text-xs text-text-secondary">
                        POS {entry.expected_count} / Found {entry.counted_count}
                      </p>
                    </div>
                    <span className={cn(
                      "px-2 py-1 rounded-md text-[10px] font-bold",
                      entry.missing_count || entry.extra_count || entry.duplicate_count ? "bg-danger/10 text-danger" : "bg-success/10 text-success"
                    )}>
                      {entry.missing_count || entry.extra_count || entry.duplicate_count ? "CHECK" : "MATCHED"}
                    </span>
                  </div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="p-8 text-center text-text-secondary">No saved audits yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {audit && hasProblem && (
        <div className="grid lg:grid-cols-3 gap-4">
          <ProblemList title="Missing Receipts" tone="danger" items={audit.missing} />
          <ProblemList title="Extra / Invalid Receipts" tone="warning" items={audit.extra} />
          <ProblemList title="Duplicate Entries" tone="warning" items={audit.duplicates} />
        </div>
      )}
    </div>
  );
}

function ProblemList({ title, items, tone }: { title: string; items: any[]; tone: "danger" | "warning" }) {
  return (
    <div className={cn("card overflow-hidden border", tone === "danger" ? "border-danger/30" : "border-warning/30")}>
      <div className={cn("p-4 border-b border-surface-4", tone === "danger" ? "bg-danger/10" : "bg-warning/10")}>
        <h3 className={cn("font-bold", tone === "danger" ? "text-danger" : "text-warning")}>{title}</h3>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-surface-4">
        {items.map((item) => (
          <div key={`${item.status}-${item.billNumber}-${item.saleId || "none"}`} className="p-3 flex items-center justify-between gap-3">
            <span className="font-mono font-bold text-text-primary">{item.billNumber}</span>
            <span className="font-mono text-text-secondary">{toMoney(item.amount)}</span>
          </div>
        ))}
        {items.length === 0 && <div className="p-6 text-center text-text-secondary">None</div>}
      </div>
    </div>
  );
}
