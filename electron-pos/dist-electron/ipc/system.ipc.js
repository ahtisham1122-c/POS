"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSystemIPC = registerSystemIPC;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const backup_1 = require("../sync/backup");
const businessDay_1 = require("../database/businessDay");
const db_1 = __importDefault(require("../database/db"));
const apiConfig_1 = require("../sync/apiConfig");
const deviceInfo_1 = require("../sync/deviceInfo");
function getCount(tableName) {
    const row = db_1.default.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
    return Number(row?.count || 0);
}
function getLatestRecord(tableName, label, orderBy = 'created_at') {
    const row = db_1.default.prepare(`
    SELECT id, '${label}' as label, '${tableName}' as tableName, ${orderBy} as recordedAt, synced
    FROM ${tableName}
    ORDER BY datetime(${orderBy}) DESC
    LIMIT 1
  `).get();
    if (!row)
        return null;
    return {
        id: row.id,
        label: row.label,
        table: row.tableName,
        recordedAt: row.recordedAt,
        synced: Number(row.synced || 0) === 1
    };
}
async function verifyLatestRecordsWithBackend(records) {
    const syncHeaders = (0, apiConfig_1.getSyncHeaders)((0, deviceInfo_1.getDeviceInfo)().deviceId);
    if (!syncHeaders) {
        return { success: false, skipped: true, error: 'SYNC_DEVICE_SECRET is not configured.' };
    }
    const apiUrl = (0, apiConfig_1.getApiBaseUrl)();
    const response = await (0, apiConfig_1.fetchWithTimeout)(`${apiUrl}/sync/verify-records`, {
        method: 'POST',
        headers: syncHeaders,
        body: JSON.stringify({ records })
    }, 10000);
    if (!response.ok) {
        return { success: false, error: `Backend returned ${response.status}` };
    }
    return response.json();
}
function registerSystemIPC() {
    electron_1.ipcMain.handle('system:backup', () => {
        const backupPath = (0, backup_1.performBackup)(true);
        if (!backupPath)
            return { success: false, error: 'Backup failed' };
        return { success: true, path: backupPath, backups: (0, backup_1.listBackups)() };
    });
    electron_1.ipcMain.handle('system:listBackups', () => {
        return {
            success: true,
            backupDir: (0, backup_1.getBackupDir)(),
            dbPath: (0, backup_1.getDatabasePath)(),
            backups: (0, backup_1.listBackups)()
        };
    });
    electron_1.ipcMain.handle('system:restore', async () => {
        const { canceled, filePaths } = await electron_1.dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'SQLite Databases', extensions: ['db', 'sqlite'] }]
        });
        if (canceled || filePaths.length === 0) {
            return { success: false, reason: 'canceled' };
        }
        try {
            const source = filePaths[0];
            const { stagedRestore, safetyBackup } = (0, backup_1.requestRestoreOnRestart)(source);
            electron_1.app.relaunch();
            electron_1.app.exit(0);
            return {
                success: true,
                restoredFrom: source,
                stagedRestore,
                safetyBackup,
                message: 'Restore scheduled. The app will close, replace the database safely, and reopen.'
            };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('system:openBackupFolder', async () => {
        const backupDir = (0, backup_1.getBackupDir)();
        if (!fs_1.default.existsSync(backupDir))
            fs_1.default.mkdirSync(backupDir, { recursive: true });
        const { shell } = await Promise.resolve().then(() => __importStar(require('electron')));
        await shell.openPath(backupDir);
        return { success: true, backupDir };
    });
    electron_1.ipcMain.handle('system:getPaths', () => {
        return {
            userData: electron_1.app.getPath('userData'),
            documents: electron_1.app.getPath('documents'),
            backupDir: (0, backup_1.getBackupDir)(),
            dbPath: (0, backup_1.getDatabasePath)()
        };
    });
    electron_1.ipcMain.handle('system:getBusinessDate', () => {
        return (0, businessDay_1.getBusinessDateInfo)();
    });
    electron_1.ipcMain.handle('system:getHealth', async () => {
        const startedAt = new Date().toISOString();
        const integrity = db_1.default.pragma('integrity_check');
        const backups = (0, backup_1.listBackups)();
        const pending = db_1.default.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get();
        const failed = db_1.default.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'`).get();
        const latestError = db_1.default.prepare(`
      SELECT error_message, table_name, record_id, last_attempted_at
      FROM sync_outbox
      WHERE status IN ('pending', 'failed') AND error_message IS NOT NULL
      ORDER BY COALESCE(last_attempted_at, created_at) DESC
      LIMIT 1
    `).get();
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
        ].filter(Boolean);
        let backendVerification = { success: false, skipped: true, error: 'No local records found to verify yet.' };
        if (latestRecords.length > 0) {
            try {
                backendVerification = await verifyLatestRecordsWithBackend(latestRecords.map((record) => ({ table: record.table, id: record.id })));
            }
            catch (error) {
                backendVerification = { success: false, error: error.message || 'Backend verification failed.' };
            }
        }
        return {
            checkedAt: startedAt,
            database: {
                ok: integrity?.[0]?.integrity_check === 'ok',
                integrity: integrity?.[0]?.integrity_check || 'unknown',
                dbPath: (0, backup_1.getDatabasePath)(),
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
            businessDate: (0, businessDay_1.getBusinessDateInfo)(),
            sync: {
                pendingCount: Number(pending?.count || 0),
                failedCount: Number(failed?.count || 0),
                latestError: latestError?.error_message || null,
                latestErrorTable: latestError?.table_name || null,
                latestErrorRecordId: latestError?.record_id || null
            },
            backups: {
                backupDir: (0, backup_1.getBackupDir)(),
                count: backups.length,
                latest: backups[0] || null
            },
            latestRecords,
            backendVerification
        };
    });
}
