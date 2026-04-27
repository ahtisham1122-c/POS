"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSyncIPC = registerSyncIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const pullSync_1 = require("../sync/pullSync");
const networkMonitor_1 = require("../sync/networkMonitor");
function registerSyncIPC(syncEngine, getMainWindow) {
    electron_1.ipcMain.handle('sync:getPendingCount', () => {
        const row = db_1.default.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get();
        return Number(row?.count || 0);
    });
    electron_1.ipcMain.handle('sync:getStatus', () => {
        const pending = db_1.default.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get();
        const failed = db_1.default.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'`).get();
        const stuck = db_1.default.prepare(`
      SELECT COUNT(*) as count, MIN(created_at) as oldestCreatedAt
      FROM sync_outbox
      WHERE status IN ('pending', 'failed')
      AND datetime(created_at) <= datetime('now', '-10 minutes')
    `).get();
        const latestError = db_1.default.prepare(`
      SELECT error_message, table_name, record_id, last_attempted_at
      FROM sync_outbox
      WHERE status IN ('pending', 'failed') AND error_message IS NOT NULL
      ORDER BY COALESCE(last_attempted_at, created_at) DESC
      LIMIT 1
    `).get();
        const lastPull = db_1.default.prepare(`SELECT value FROM settings WHERE key = 'last_pull_timestamp'`).get();
        const failedCount = Number(failed?.count || 0);
        return {
            status: failedCount > 0 || Number(stuck?.count || 0) > 0 ? 'error' : (networkMonitor_1.networkMonitor.isOnline ? 'online' : 'offline'),
            pendingCount: Number(pending?.count || 0),
            failedCount,
            stuckCount: Number(stuck?.count || 0),
            oldestStuckCreatedAt: stuck?.oldestCreatedAt || null,
            latestError: latestError?.error_message || null,
            latestErrorTable: latestError?.table_name || null,
            lastSyncedAt: lastPull?.value || null
        };
    });
    electron_1.ipcMain.handle('sync:syncNow', async () => {
        try {
            db_1.default.prepare(`
        UPDATE sync_outbox
        SET status = 'pending', last_attempted_at = NULL
        WHERE status = 'failed'
      `).run();
            await syncEngine.processPendingOutbox();
            await (0, pullSync_1.pullSync)(getMainWindow() || undefined);
            const pending = db_1.default.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'pending'`).get();
            const failed = db_1.default.prepare(`SELECT COUNT(*) as count FROM sync_outbox WHERE status = 'failed'`).get();
            return { success: true, pendingCount: Number(pending?.count || 0), failedCount: Number(failed?.count || 0) };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
}
