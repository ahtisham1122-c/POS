import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";

type SyncState = "SYNCED" | "SYNCING" | "OFFLINE" | "ERROR";

export function SyncStatusBadge() {
  const [status, setStatus] = useState<SyncState>("SYNCED");
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [stuckCount, setStuckCount] = useState(0);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [lastSync, setLastSync] = useState(new Date());

  const applyStatus = (syncStatus: any) => {
    const pending = Number(syncStatus?.pendingCount || 0);
    const failed = Number(syncStatus?.failedCount || 0);
    const stuck = Number(syncStatus?.stuckCount || 0);

    setPendingCount(pending);
    setFailedCount(failed);
    setStuckCount(stuck);
    setLatestError(syncStatus?.latestError || null);

    if (syncStatus?.status === "syncing" || syncStatus?.status === "running") {
      setStatus("SYNCING");
    } else if (syncStatus?.status === "error" || failed > 0 || stuck > 0) {
      setStatus("ERROR");
    } else if (pending > 0) {
      setStatus("OFFLINE");
    } else {
      setStatus("SYNCED");
      setLastSync(new Date());
    }
  };

  useEffect(() => {
    let alive = true;
    const checkSync = async () => {
      try {
        const syncStatus = await window.electronAPI?.sync?.getStatus();
        if (!alive || !syncStatus) return;
        applyStatus(syncStatus);
      } catch {
        if (!alive) return;
        setStatus("ERROR");
      }
    };

    checkSync();
    const timer = setInterval(checkSync, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const handleSyncNow = async () => {
    setStatus("SYNCING");
    try {
      await window.electronAPI?.sync?.syncNow();
      const syncStatus = await window.electronAPI?.sync?.getStatus();
      applyStatus(syncStatus);
    } catch {
      setStatus("ERROR");
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
          status === "SYNCED" && "bg-success/10 text-success border-success/30 hover:bg-success/20",
          status === "SYNCING" && "bg-warning/10 text-warning border-warning/30 hover:bg-warning/20",
          status === "OFFLINE" && "bg-danger/10 text-danger border-danger/30 hover:bg-danger/20",
          status === "ERROR" && "bg-danger/10 text-danger border-danger/30 hover:bg-danger/20"
        )}
      >
        {status === "SYNCED" && <div className="w-2 h-2 rounded-full bg-success animate-pulse-dot" />}
        {status === "SYNCING" && <Loader2 className="w-3 h-3 animate-spin" />}
        {status === "OFFLINE" && <div className="w-2 h-2 rounded-full bg-danger" />}
        {status === "ERROR" && <AlertTriangle className="w-3 h-3" />}

        <span>
          {status === "SYNCED" && "Live"}
          {status === "SYNCING" && `Syncing ${pendingCount}...`}
          {status === "OFFLINE" && `Offline - ${pendingCount} queued`}
          {status === "ERROR" && `${stuckCount || failedCount || pendingCount} Unsynced`}
        </span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 card p-4 z-50 flex flex-col gap-3 animate-slide-up">
            <h4 className="font-semibold text-sm">Sync Status</h4>
            <div className="text-sm text-text-secondary flex justify-between">
              <span>Last Sync:</span>
              <span>{lastSync.toLocaleTimeString()}</span>
            </div>
            <div className="text-sm text-text-secondary flex justify-between">
              <span>Pending Items:</span>
              <span>{pendingCount}</span>
            </div>
            <div className="text-sm text-text-secondary flex justify-between">
              <span>Failed Items:</span>
              <span className={failedCount > 0 ? "text-danger font-bold" : ""}>{failedCount}</span>
            </div>
            <div className="text-sm text-text-secondary flex justify-between">
              <span>Stuck &gt; 10 min:</span>
              <span className={stuckCount > 0 ? "text-danger font-bold" : ""}>{stuckCount}</span>
            </div>
            {latestError && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
                {latestError}
              </div>
            )}
            <button
              onClick={handleSyncNow}
              className="btn-secondary w-full flex items-center justify-center gap-2 mt-2"
              disabled={status === "SYNCING"}
            >
              <RefreshCw className={cn("w-4 h-4", status === "SYNCING" && "animate-spin")} />
              Sync Now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
