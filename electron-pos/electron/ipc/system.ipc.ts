import { ipcMain, dialog, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getBackupDir, getDatabasePath, listBackups, performBackup, requestRestoreOnRestart } from '../sync/backup';
import { getBusinessDateInfo } from '../database/businessDay';
import db from '../database/db';
import { fetchWithTimeout, getApiBaseUrl, getSyncHeaders } from '../sync/apiConfig';
import { getDeviceInfo } from '../sync/deviceInfo';

function getCount(tableName: string) {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as any;
  return Number(row?.count || 0);
}

function getLatestRecord(tableName: string, label: string, orderBy = 'created_at') {
  const row = db.prepare(`
    SELECT id, '${label}' as label, '${tableName}' as tableName, ${orderBy} as recordedAt, synced
    FROM ${tableName}
    ORDER BY datetime(${orderBy}) DESC
    LIMIT 1
  `).get() as any;

  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    table: row.tableName,
    recordedAt: row.recordedAt,
    synced: Number(row.synced || 0) === 1
  };
}

async function verifyLatestRecordsWithBackend(records: Array<{ table: string; id: string }>) {
  const syncHeaders = getSyncHeaders(getDeviceInfo().deviceId);
  if (!syncHeaders) {
    return { success: false, skipped: true, error: 'SYNC_DEVICE_SECRET is not configured.' };
  }

  const apiUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(`${apiUrl}/sync/verify-records`, {
    method: 'POST',
    headers: syncHeaders,
    body: JSON.stringify({ records })
  }, 10000);

  if (!response.ok) {
    return { success: false, error: `Backend returned ${response.status}` };
  }

  return response.json();
}

export function registerSystemIPC() {
  ipcMain.handle('system:backup', () => {
    const backupPath = performBackup(true);
    if (!backupPath) return { success: false, error: 'Backup failed' };
    return { success: true, path: backupPath, backups: listBackups() };
  });

  ipcMain.handle('system:listBackups', () => {
    return {
      success: true,
      backupDir: getBackupDir(),
      dbPath: getDatabasePath(),
      backups: listBackups()
    };
  });

  ipcMain.handle('system:restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'SQLite Databases', extensions: ['db', 'sqlite'] }]
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, reason: 'canceled' };
    }

    try {
      const source = filePaths[0];
      const { stagedRestore, safetyBackup } = requestRestoreOnRestart(source);

      app.relaunch();
      app.exit(0);
      return {
        success: true,
        restoredFrom: source,
        stagedRestore,
        safetyBackup,
        message: 'Restore scheduled. The app will close, replace the database safely, and reopen.'
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('system:openBackupFolder', async () => {
    const backupDir = getBackupDir();
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const { shell } = await import('electron');
    await shell.openPath(backupDir);
    return { success: true, backupDir };
  });

  ipcMain.handle('system:getPaths', () => {
    return {
      userData: app.getPath('userData'),
      documents: app.getPath('documents'),
      backupDir: getBackupDir(),
      dbPath: getDatabasePath()
    };
  });

  ipcMain.handle('system:getBusinessDate', () => {
    return getBusinessDateInfo();
  });

  ipcMain.handle('system:getHealth', async () => {
    const startedAt = new Date().toISOString();
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const backups = listBackups();
    const pending = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get() as any;
    const failed = db.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'`).get() as any;
    const latestError = db.prepare(`
      SELECT error_message, table_name, record_id, last_attempted_at
      FROM sync_outbox
      WHERE status IN ('pending', 'failed') AND error_message IS NOT NULL
      ORDER BY COALESCE(last_attempted_at, created_at) DESC
      LIMIT 1
    `).get() as any;

    const latestRecords = [
      getLatestRecord('shifts', 'Latest shift', 'opened_at'),
      getLatestRecord('cash_register', 'Latest cash register'),
      getLatestRecord('sales', 'Latest sale'),
      getLatestRecord('sale_items', 'Latest sale item'),
      getLatestRecord('returns', 'Latest return'),
      getLatestRecord('return_items', 'Latest return item'),
      getLatestRecord('milk_collections', 'Latest milk collection'),
      getLatestRecord('supplier_payments', 'Latest supplier payment'),
      getLatestRecord('supplier_ledger_entries', 'Latest supplier ledger'),
      getLatestRecord('receipt_audit_sessions', 'Latest receipt audit session'),
      getLatestRecord('receipt_audit_entries', 'Latest receipt audit entry')
    ].filter(Boolean) as Array<{ table: string; id: string; label: string; recordedAt: string; synced: boolean }>;

    let backendVerification: any = { success: false, skipped: true, error: 'No local records found to verify yet.' };
    if (latestRecords.length > 0) {
      try {
        backendVerification = await verifyLatestRecordsWithBackend(
          latestRecords.map((record) => ({ table: record.table, id: record.id }))
        );
      } catch (error: any) {
        backendVerification = { success: false, error: error.message || 'Backend verification failed.' };
      }
    }

    return {
      checkedAt: startedAt,
      database: {
        ok: integrity?.[0]?.integrity_check === 'ok',
        integrity: integrity?.[0]?.integrity_check || 'unknown',
        dbPath: getDatabasePath(),
        counts: {
          products: getCount('products'),
          customers: getCount('customers'),
          suppliers: getCount('suppliers'),
          sales: getCount('sales'),
          returns: getCount('returns'),
          shifts: getCount('shifts'),
          cashRegisters: getCount('cash_register'),
          receiptAudits: getCount('receipt_audit_sessions')
        }
      },
      businessDate: getBusinessDateInfo(),
      sync: {
        pendingCount: Number(pending?.count || 0),
        failedCount: Number(failed?.count || 0),
        latestError: latestError?.error_message || null,
        latestErrorTable: latestError?.table_name || null,
        latestErrorRecordId: latestError?.record_id || null
      },
      backups: {
        backupDir: getBackupDir(),
        count: backups.length,
        latest: backups[0] || null
      },
      latestRecords,
      backendVerification
    };
  });
}
