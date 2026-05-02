import { BrowserWindow, ipcMain } from 'electron';
import db from '../database/db';
import { pullSync } from '../sync/pullSync';
import { networkMonitor } from '../sync/networkMonitor';
import { SyncEngine } from '../sync/syncEngine';
import { registerDeviceWithCloud } from '../sync/deviceRegistration';

export function registerSyncIPC(syncEngine: SyncEngine, getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('sync:getPendingCount', () => {
    const row = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get() as any;
    return Number(row?.count || 0);
  });

  ipcMain.handle('sync:getStatus', () => {
    const pending = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get() as any;
    const failed = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'`).get() as any;
    const waitingParent = db.prepare(`
      SELECT COUNT(*) as count
      FROM sync_outbox
      WHERE status IN ('pending', 'failed')
      AND (
        error_message LIKE 'Waiting for parent:%'
        OR error_message LIKE '%Missing parent%'
      )
    `).get() as any;
    const authErrors = db.prepare(`
      SELECT COUNT(*) as count
      FROM sync_outbox
      WHERE status IN ('pending', 'failed')
      AND (
        error_message LIKE '%Auth failed%'
        OR error_message LIKE '%401%'
        OR error_message LIKE '%403%'
        OR error_message LIKE '%Sync Device Secret%'
      )
    `).get() as any;
    const backendErrors = db.prepare(`
      SELECT COUNT(*) as count
      FROM sync_outbox
      WHERE status IN ('pending', 'failed')
      AND error_message LIKE 'Server Error%'
      AND error_message NOT LIKE '%Missing parent%'
    `).get() as any;
    const stuck = db.prepare(`
      SELECT COUNT(*) as count, MIN(created_at) as oldestCreatedAt
      FROM sync_outbox
      WHERE status IN ('pending', 'failed')
      AND datetime(created_at) <= datetime('now', '-10 minutes')
    `).get() as any;
    const latestError = db.prepare(`
      SELECT error_message, table_name, record_id, last_attempted_at
      FROM sync_outbox
      WHERE status IN ('pending', 'failed') AND error_message IS NOT NULL
      ORDER BY COALESCE(last_attempted_at, created_at) DESC
      LIMIT 1
    `).get() as any;
    const lastPull = db.prepare(`SELECT value FROM settings WHERE key = 'last_pull_timestamp'`).get() as any;
    const failedCount = Number(failed?.count || 0);
    const waitingParentCount = Number(waitingParent?.count || 0);
    const authErrorCount = Number(authErrors?.count || 0);
    const backendErrorCount = Number(backendErrors?.count || 0);
    const pendingCount = Number(pending?.count || 0);
    const stuckCount = Number(stuck?.count || 0);
    const nonRecoverableFailedCount = Math.max(0, failedCount - waitingParentCount);
    let status = networkMonitor.isOnline ? 'online' : 'offline';
    let statusReason = networkMonitor.isOnline ? 'Connected' : 'Backend/network is offline';
    if (authErrorCount > 0) {
      status = 'config_error';
      statusReason = 'Sync secret or device registration is wrong';
    } else if (backendErrorCount > 0 || nonRecoverableFailedCount > 0) {
      status = 'error';
      statusReason = 'Backend rejected one or more records';
    } else if (waitingParentCount > 0) {
      status = 'recovering';
      statusReason = 'Waiting for parent records to sync first';
    } else if (pendingCount > 0 || stuckCount > 0) {
      status = 'syncing';
      statusReason = 'Records are waiting to sync';
    }

    return {
      status,
      statusReason,
      pendingCount,
      failedCount,
      stuckCount,
      waitingParentCount,
      authErrorCount,
      backendErrorCount,
      oldestStuckCreatedAt: stuck?.oldestCreatedAt || null,
      latestError: latestError?.error_message || null,
      latestErrorTable: latestError?.table_name || null,
      lastSyncedAt: lastPull?.value || null
    };
  });

  ipcMain.handle('sync:syncNow', async () => {
    try {
      await registerDeviceWithCloud().catch(() => null);
      syncEngine.repairMissingParentsFromOutbox();
      db.prepare(`
        UPDATE sync_outbox
        SET status = 'pending',
            attempt_count = 0,
            error_message = NULL,
            last_attempted_at = NULL
        WHERE status = 'failed'
           OR (status = 'pending' AND error_message IS NOT NULL)
      `).run();
      syncEngine.repairMissingParentsFromOutbox();
      await syncEngine.processPendingOutbox();
      await pullSync(getMainWindow() || undefined);
      const pending = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get() as any;
      const failed = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'`).get() as any;
      return { success: true, pendingCount: Number(pending?.count || 0), failedCount: Number(failed?.count || 0) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('sync:getFailedRows', () => {
    return db.prepare(`
      SELECT id, table_name, record_id, operation, error_message, attempt_count,
             last_attempted_at, created_at
      FROM sync_outbox
      WHERE status IN ('failed', 'pending') AND error_message IS NOT NULL
      ORDER BY COALESCE(last_attempted_at, created_at) DESC
      LIMIT 100
    `).all();
  });

  ipcMain.handle('sync:dismissRow', (_event, id: string) => {
    db.prepare(`UPDATE sync_outbox SET status = 'failed', error_message = 'Dismissed by user' WHERE id = ?`).run(id);
    return { success: true };
  });
}
