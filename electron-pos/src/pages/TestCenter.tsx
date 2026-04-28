import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  Printer,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Stethoscope,
  Wallet,
  XCircle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "../lib/utils";
import type { PageId } from "../App";

type StepStatus = "pending" | "done" | "blocked";

type TestStep = {
  id: string;
  label: string;
  page: PageId;
  icon: any;
};

const flowSteps: TestStep[] = [
  { id: "open-shift", label: "Open shift", page: "shifts", icon: BadgeCheck },
  { id: "open-register", label: "Open cash register", page: "cash-register", icon: Wallet },
  { id: "make-sale", label: "Make sale", page: "pos", icon: ShoppingCart },
  { id: "print-receipt", label: "Print receipt", page: "pos", icon: Printer },
  { id: "reprint-receipt", label: "Reprint receipt", page: "reports", icon: FileText },
  { id: "refund-return", label: "Refund / return", page: "returns", icon: RotateCcw },
  { id: "receipt-audit", label: "Receipt audit", page: "receipt-audit", icon: ClipboardCheck },
  { id: "close-shift", label: "Close shift", page: "shifts", icon: ShieldCheck },
  { id: "sync-backend", label: "Sync to backend", page: "test-center", icon: RefreshCw },
  { id: "backend-records", label: "Backend records exist", page: "test-center", icon: Database }
];

const statusStyles: Record<StepStatus, string> = {
  pending: "border-surface-4 bg-surface-2 text-text-secondary",
  done: "border-success/30 bg-success/10 text-success",
  blocked: "border-danger/30 bg-danger/10 text-danger"
};

function formatDate(value?: string | null) {
  if (!value) return "Not found";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDistanceToNow(date, { addSuffix: true });
}

function HealthTile({
  title,
  value,
  status,
  detail,
  icon: Icon
}: {
  title: string;
  value: string;
  status: "good" | "warn" | "bad";
  detail?: string;
  icon: any;
}) {
  return (
    <div className={cn(
      "border rounded-lg p-4 bg-surface-2 min-h-[132px]",
      status === "good" && "border-success/30",
      status === "warn" && "border-warning/30",
      status === "bad" && "border-danger/30"
    )}>
      <div className="flex items-center justify-between gap-3">
        <div className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center",
          status === "good" && "bg-success/10 text-success",
          status === "warn" && "bg-warning/10 text-warning",
          status === "bad" && "bg-danger/10 text-danger"
        )}>
          <Icon className="w-5 h-5" />
        </div>
        {status === "good" ? <CheckCircle2 className="w-5 h-5 text-success" /> :
          status === "warn" ? <AlertTriangle className="w-5 h-5 text-warning" /> :
          <XCircle className="w-5 h-5 text-danger" />}
      </div>
      <p className="text-xs uppercase font-bold text-text-secondary mt-4">{title}</p>
      <p className="text-lg font-bold text-text-primary mt-1">{value}</p>
      {detail && <p className="text-xs text-text-secondary mt-2 leading-relaxed">{detail}</p>}
    </div>
  );
}

export default function TestCenter({ setPage }: { setPage: (page: PageId) => void }) {
  const [health, setHealth] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [printers, setPrinters] = useState<any[]>([]);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [cashRegister, setCashRegister] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [runningSync, setRunningSync] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);
  const [steps, setSteps] = useState<Record<string, StepStatus>>(() => {
    try {
      return JSON.parse(localStorage.getItem("noon-test-center-steps") || "{}");
    } catch {
      return {};
    }
  });

  const backendFound = Number(health?.backendVerification?.found || 0);
  const backendChecked = Number(health?.backendVerification?.checked || 0);
  const latestBackup = health?.backups?.latest;
  const syncBad = Number(syncStatus?.failedCount || 0) > 0 || Number(syncStatus?.stuckCount || 0) > 0;
  const pendingCount = Number(syncStatus?.pendingCount || 0);

  const completedCount = useMemo(() => {
    return flowSteps.filter((step) => steps[step.id] === "done").length;
  }, [steps]);

  useEffect(() => {
    localStorage.setItem("noon-test-center-steps", JSON.stringify(steps));
  }, [steps]);

  useEffect(() => {
    setSteps((previous) => {
      const next = { ...previous };
      if (currentShift && next["open-shift"] !== "blocked") next["open-shift"] = "done";
      if (cashRegister && !cashRegister.is_closed_for_day && next["open-register"] !== "blocked") next["open-register"] = "done";
      if (!syncBad && pendingCount === 0 && next["sync-backend"] !== "blocked") next["sync-backend"] = "done";
      if (backendChecked > 0 && backendFound === backendChecked && next["backend-records"] !== "blocked") next["backend-records"] = "done";
      return next;
    });
  }, [backendChecked, backendFound, cashRegister, currentShift, pendingCount, syncBad]);

  async function loadHealth() {
    setLoading(true);
    setMessage(null);
    try {
      const [healthResult, syncResult, printerResult, shiftResult, registerResult] = await Promise.all([
        window.electronAPI?.system?.getHealth(),
        window.electronAPI?.sync?.getStatus(),
        window.electronAPI?.printer?.getPrinters(),
        window.electronAPI?.shifts?.getCurrent(),
        window.electronAPI?.cashRegister?.getToday()
      ]);
      setHealth(healthResult);
      setSyncStatus(syncResult);
      setPrinters(printerResult?.printers || []);
      setCurrentShift(shiftResult);
      setCashRegister(registerResult);
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Health check failed." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHealth();
  }, []);

  function setStepStatus(stepId: string, status: StepStatus) {
    setSteps((previous) => ({ ...previous, [stepId]: status }));
  }

  function resetChecklist() {
    const confirmed = confirm("Reset the Test Center checklist?");
    if (!confirmed) return;
    setSteps({});
  }

  async function syncNow() {
    setRunningSync(true);
    setMessage(null);
    try {
      const result = await window.electronAPI?.sync?.syncNow();
      if (!result?.success) {
        setMessage({ type: "error", text: result?.error || "Sync failed." });
        return;
      }
      setMessage({ type: "success", text: `Sync complete. Pending: ${result.pendingCount}, failed: ${result.failedCount}.` });
      if (Number(result.pendingCount || 0) === 0 && Number(result.failedCount || 0) === 0) {
        setStepStatus("sync-backend", "done");
      }
      await loadHealth();
    } finally {
      setRunningSync(false);
    }
  }

  async function createBackup() {
    setMessage(null);
    const result = await window.electronAPI?.system?.backup();
    if (!result?.success) {
      setMessage({ type: "error", text: result?.error || "Backup failed." });
      return;
    }
    setMessage({ type: "success", text: `Backup created: ${result.path}` });
    await loadHealth();
  }

  async function testPrint() {
    const confirmed = confirm("Print a small test receipt now?");
    if (!confirmed) return;
    const result = await window.electronAPI?.printer?.printReceipt({
      billNumber: "TEST-CENTER",
      date: new Date().toISOString(),
      customer: "Walk-in",
      paymentType: "CASH",
      subtotal: 10,
      discount: 0,
      taxAmount: 0,
      grandTotal: 10,
      amountPaid: 10,
      changeToReturn: 0,
      items: [{ name: "Printer Test", quantity: 1, price: 10, lineTotal: 10 }]
    });
    setMessage(result?.success
      ? { type: "success", text: "Test receipt sent to printer." }
      : { type: "error", text: result?.error || "Printer test failed." }
    );
    if (result?.success) setStepStatus("print-receipt", "done");
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 animate-slide-up">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">System Health / Test Center</h1>
          <p className="text-text-secondary mt-1">Full shop-flow test before adding more features.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={loadHealth} disabled={loading} className="btn-secondary flex items-center justify-center gap-2">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </button>
          <button onClick={syncNow} disabled={runningSync} className="btn-primary flex items-center justify-center gap-2">
            <RefreshCw className={cn("w-4 h-4", runningSync && "animate-spin")} />
            Sync Now
          </button>
        </div>
      </div>

      {message && (
        <div className={cn(
          "rounded-lg border px-4 py-3 flex items-start gap-3",
          message.type === "success" ? "border-success/30 bg-success/10 text-success" :
          message.type === "warning" ? "border-warning/30 bg-warning/10 text-warning" :
          "border-danger/30 bg-danger/10 text-danger"
        )}>
          {message.type === "success" ? <CheckCircle2 className="w-5 h-5 mt-0.5" /> : <AlertTriangle className="w-5 h-5 mt-0.5" />}
          <span className="font-medium break-all">{message.text}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <HealthTile
          title="Database"
          value={health?.database?.ok ? "Healthy" : "Needs check"}
          status={health?.database?.ok ? "good" : "bad"}
          detail={`Sales ${health?.database?.counts?.sales ?? 0}, returns ${health?.database?.counts?.returns ?? 0}`}
          icon={Database}
        />
        <HealthTile
          title="Printer"
          value={printers.length > 0 ? `${printers.length} found` : "No printer"}
          status={printers.length > 0 ? "good" : "warn"}
          detail={printers.find((printer) => printer.isDefault)?.displayName || printers[0]?.displayName || "Install or select thermal printer"}
          icon={Printer}
        />
        <HealthTile
          title="Shift / Register"
          value={currentShift ? "Shift open" : "No open shift"}
          status={currentShift && cashRegister && !cashRegister.is_closed_for_day ? "good" : "warn"}
          detail={cashRegister && !cashRegister.is_closed_for_day ? "Cash register open" : "Cash register not open"}
          icon={Wallet}
        />
        <HealthTile
          title="Cloud Sync"
          value={syncBad ? "Error" : pendingCount > 0 ? `${pendingCount} pending` : "Clean"}
          status={syncBad ? "bad" : pendingCount > 0 ? "warn" : "good"}
          detail={syncStatus?.latestError || `Last sync: ${formatDate(syncStatus?.lastSyncedAt)}`}
          icon={RefreshCw}
        />
      </div>

      <div className="grid xl:grid-cols-[1.1fr_0.9fr] gap-6">
        <section className="card overflow-hidden">
          <div className="p-5 border-b border-surface-4 bg-surface-2/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Real Shop Flow</h2>
              <p className="text-sm text-text-secondary">{completedCount} of {flowSteps.length} checks complete</p>
            </div>
            <button onClick={resetChecklist} className="btn-secondary h-10 flex items-center justify-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>

          <div className="divide-y divide-surface-4">
            {flowSteps.map((step, index) => {
              const Icon = step.icon;
              const status = steps[step.id] || "pending";
              return (
                <div key={step.id} className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-surface-3 flex items-center justify-center text-text-secondary font-bold shrink-0">
                      {index + 1}
                    </div>
                    <Icon className="w-5 h-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="font-bold text-text-primary truncate">{step.label}</p>
                      <p className="text-xs text-text-secondary">{status === "done" ? "Passed" : status === "blocked" ? "Blocked" : "Waiting"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setStepStatus(step.id, "done")}
                      className={cn("px-3 py-2 rounded-md border text-sm font-bold", status === "done" ? statusStyles.done : "border-surface-4 text-text-secondary hover:bg-surface-3")}
                    >
                      Pass
                    </button>
                    <button
                      onClick={() => setStepStatus(step.id, "blocked")}
                      className={cn("px-3 py-2 rounded-md border text-sm font-bold", status === "blocked" ? statusStyles.blocked : "border-surface-4 text-text-secondary hover:bg-surface-3")}
                    >
                      Block
                    </button>
                    {step.id === "sync-backend" ? (
                      <button onClick={syncNow} className="btn-primary h-10 px-4 flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" />
                        Run
                      </button>
                    ) : (
                      <button onClick={() => setPage(step.page)} className="btn-secondary h-10 px-4">
                        Open
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-6">
          <div className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Backend Verification</h2>
                <p className="text-sm text-text-secondary mt-1">
                  {backendChecked > 0 ? `${backendFound} of ${backendChecked} latest records found in backend` : "No synced records checked yet"}
                </p>
              </div>
              <div className={cn(
                "w-11 h-11 rounded-lg flex items-center justify-center",
                backendChecked > 0 && backendFound === backendChecked ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
              )}>
                <Stethoscope className="w-6 h-6" />
              </div>
            </div>

            {health?.backendVerification?.error && (
              <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 text-warning px-3 py-2 text-sm font-medium">
                {health.backendVerification.error}
              </div>
            )}

            <div className="mt-4 space-y-2 max-h-[280px] overflow-auto pr-1">
              {(health?.latestRecords || []).map((record: any) => {
                const match = health?.backendVerification?.results?.find((result: any) => result.id === record.id);
                const found = Boolean(match?.found);
                return (
                  <div key={`${record.table}-${record.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-surface-4 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-text-primary truncate">{record.label}</p>
                      <p className="text-xs text-text-secondary font-mono truncate">{record.id}</p>
                    </div>
                    <span className={cn("px-2 py-1 rounded text-xs font-bold shrink-0", found ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                      {found ? "Found" : record.synced ? "Check" : "Local"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-lg font-bold text-text-primary">Quick Checks</h2>
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <button onClick={testPrint} className="btn-secondary h-12 flex items-center justify-center gap-2">
                <Printer className="w-4 h-4" />
                Test Print
              </button>
              <button onClick={createBackup} className="btn-secondary h-12 flex items-center justify-center gap-2">
                <Archive className="w-4 h-4" />
                Backup
              </button>
              <button onClick={() => setPage("reports")} className="btn-secondary h-12 flex items-center justify-center gap-2">
                <FileText className="w-4 h-4" />
                Reports
              </button>
              <button onClick={() => setPage("settings")} className="btn-secondary h-12 flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Settings
              </button>
            </div>
            <div className="mt-4 rounded-lg bg-surface-3 p-3 text-sm text-text-secondary">
              <p><span className="font-bold text-text-primary">Business day:</span> {health?.businessDate?.date || "Loading..."}</p>
              <p><span className="font-bold text-text-primary">Backups:</span> {health?.backups?.count || 0} found, latest {formatDate(latestBackup?.modifiedAt)}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
