import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, DatabaseBackup, FolderOpen, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "../lib/utils";

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function BackupRestore() {
  const [backupDir, setBackupDir] = useState("");
  const [dbPath, setDbPath] = useState("");
  const [backups, setBackups] = useState<any[]>([]);
  const [message, setMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);

  const latestBackup = useMemo(() => backups[0], [backups]);

  async function loadBackups() {
    setIsLoading(true);
    try {
      const result = await window.electronAPI?.system?.listBackups();
      if (result?.success) {
        setBackupDir(result.backupDir);
        setDbPath(result.dbPath);
        setBackups(result.backups || []);
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadBackups();
  }, []);

  async function createBackup() {
    setMessage(null);
    const result = await window.electronAPI?.system?.backup();
    if (!result?.success) {
      setMessage({ type: "error", text: result?.error || "Backup failed." });
      return;
    }
    setMessage({ type: "success", text: `Backup created: ${result.path}` });
    await loadBackups();
  }

  async function restoreBackup() {
    setMessage(null);
    const confirmed = confirm(
      "Restore will replace the current Noon Dairy POS database.\n\nThe app will create a safety backup, close, restore the selected file, and reopen.\n\nOnly continue if you are 100% sure."
    );
    if (!confirmed) return;

    const typed = prompt("Type RESTORE to confirm this dangerous action.");
    if (typed !== "RESTORE") {
      setMessage({ type: "warning", text: "Restore cancelled. You must type RESTORE exactly." });
      return;
    }

    setIsRestoring(true);
    try {
      const result = await window.electronAPI?.system?.restore();
      if (!result?.success) {
        if (result?.reason === "canceled") return;
        setMessage({ type: "error", text: result?.error || "Restore failed." });
        return;
      }
      setMessage({
        type: "warning",
        text: `${result.message || "Restore complete."} Safety backup: ${result.safetyBackup || "not created"}`
      });
      await loadBackups();
    } finally {
      setIsRestoring(false);
    }
  }

  async function openBackupFolder() {
    await window.electronAPI?.system?.openBackupFolder();
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 animate-slide-up">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Backup & Restore</h1>
          <p className="text-text-secondary mt-1">Protect sales, khata, stock, shifts, receipts, and cash records from loss.</p>
        </div>
        <button onClick={loadBackups} className="btn-secondary flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {message && (
        <div className={cn(
          "rounded-xl border px-4 py-3 flex items-start gap-3",
          message.type === "success" ? "border-success/30 bg-success/10 text-success" :
          message.type === "warning" ? "border-warning/30 bg-warning/10 text-warning" :
          "border-danger/30 bg-danger/10 text-danger"
        )}>
          {message.type === "success" ? <ShieldCheck className="w-5 h-5 mt-0.5" /> : <AlertTriangle className="w-5 h-5 mt-0.5" />}
          <span className="font-medium break-all">{message.text}</span>
        </div>
      )}

      <div className="grid xl:grid-cols-[0.85fr_1.15fr] gap-6">
        <div className="space-y-6">
          <div className="card p-5 border-t-4 border-t-primary">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <DatabaseBackup className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-text-primary">Manual Backup</h2>
                <p className="text-sm text-text-secondary mt-1">
                  Create a copy of the full local database before closing shop, Windows repair, or moving to another PC.
                </p>
              </div>
            </div>
            <button onClick={createBackup} className="btn-primary w-full h-12 mt-5 flex items-center justify-center gap-2">
              <Archive className="w-5 h-5" />
              Create Backup Now
            </button>
          </div>

          <div className="card p-5 border-t-4 border-t-danger">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-danger/15 text-danger flex items-center justify-center">
                <RotateCcw className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-text-primary">Restore Backup</h2>
                <p className="text-sm text-text-secondary mt-1">
                  Restore only when data is damaged or moving to another PC. The app creates a safety backup first.
                </p>
              </div>
            </div>
            <button
              onClick={restoreBackup}
              disabled={isRestoring}
              className="w-full h-12 mt-5 rounded-lg bg-danger hover:bg-danger/90 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2"
            >
              <AlertTriangle className="w-5 h-5" />
              {isRestoring ? "Restoring..." : "Restore From Backup File"}
            </button>
          </div>

          <div className="card p-5">
            <h2 className="text-lg font-bold text-text-primary">Storage Location</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <p className="text-xs text-text-secondary uppercase font-bold">Database</p>
                <p className="font-mono text-text-primary break-all">{dbPath || "Loading..."}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary uppercase font-bold">Backups Folder</p>
                <p className="font-mono text-text-primary break-all">{backupDir || "Loading..."}</p>
              </div>
            </div>
            <button onClick={openBackupFolder} className="btn-secondary w-full h-11 mt-5 flex items-center justify-center gap-2">
              <FolderOpen className="w-4 h-4" />
              Open Backup Folder
            </button>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-5 border-b border-surface-4 bg-surface-2/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Backup History</h2>
              <p className="text-sm text-text-secondary">
                {latestBackup ? `Latest backup ${formatDistanceToNow(new Date(latestBackup.modifiedAt), { addSuffix: true })}` : "No backups found yet."}
              </p>
            </div>
            <span className={cn(
              "px-3 py-1 rounded-full text-xs font-bold",
              latestBackup ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
            )}>
              {backups.length} backup{backups.length === 1 ? "" : "s"}
            </span>
          </div>

          {isLoading ? (
            <div className="p-12 flex justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-text-secondary" />
            </div>
          ) : backups.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-widest font-bold">
                  <tr>
                    <th className="px-4 py-3">Backup File</th>
                    <th className="px-4 py-3">Modified</th>
                    <th className="px-4 py-3 text-right">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-4">
                  {backups.map((backup) => (
                    <tr key={backup.path} className="hover:bg-surface-3/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-bold text-text-primary">{backup.fileName}</p>
                        <p className="text-xs text-text-secondary font-mono max-w-lg truncate">{backup.path}</p>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {formatDistanceToNow(new Date(backup.modifiedAt), { addSuffix: true })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-text-primary">{formatBytes(backup.sizeBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center text-text-secondary">
              <DatabaseBackup className="w-14 h-14 mx-auto opacity-40 mb-3" />
              <p className="font-bold text-text-primary">No backups yet</p>
              <p className="text-sm mt-1">Create your first backup before using the software with real money.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
