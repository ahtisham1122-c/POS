import { BrowserWindow, ipcMain } from 'electron';
import db from '../database/db';
import { pullSync } from '../sync/pullSync';
import { networkMonitor } from '../sync/networkMonitor';
import { SyncEngine } from '../sync/syncEngine';

export function registerSyncIPC(syncEngine: SyncEngine, getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('sync:getPendingCount', () => {
    const row = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get() as any;
    return Number(row?.count || 0);
  });

  ipcMain.handle('sync:getStatus', () => {
    const pending = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get() as any;
    const failed = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'`).get() as any;
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
    return {
      status: failedCount > 0 || Number(stuck?.count || 0) > 0 ? 'error' : (networkMonitor.isOnline ? 'online' : 'offline'),
      pendingCount: Number(pending?.count || 0),
      failedCount,
      stuckCount: Number(stuck?.count || 0),
      oldestStuckCreatedAt: stuck?.oldestCreatedAt || null,
      latestError: latestError?.error_message || null,
      latestErrorTable: latestError?.table_name || null,
      lastSyncedAt: lastPull?.value || null
    };
  });

  ipcMain.handle('sync:syncNow', async () => {
    try {
      db.prepare(`
        UPDATE sync_outbox
        SET status = 'pending', last_attempted_at = NULL
        WHERE status = 'failed'
      `).run();
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
