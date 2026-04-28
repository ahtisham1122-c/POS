"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncEngine = void 0;
const db_1 = __importDefault(require("../database/db"));
const networkMonitor_1 = require("./networkMonitor");
const apiConfig_1 = require("./apiConfig");
const deviceInfo_1 = require("./deviceInfo");
const logger_1 = __importDefault(require("../utils/logger"));
class SyncEngine {
    interval = null;
    isSyncing = false;
    handleNetworkOnline = () => {
        console.log('Network is back online, triggering sync');
        this.processPendingOutbox();
    };
    getRetryDelayMs(attemptCount) {
        const minutes = [1, 2, 5, 15, 30, 60][Math.min(Math.max(attemptCount, 0), 5)];
        return minutes * 60 * 1000;
    }
    start() {
        if (this.interval)
            return;
        console.log('SyncEngine started');
        this.interval = setInterval(() => this.processPendingOutbox(), 5000);
        networkMonitor_1.networkMonitor.on('online', this.handleNetworkOnline);
    }
    stop() {
        if (this.interval)
            clearInterval(this.interval);
        this.interval = null;
        networkMonitor_1.networkMonitor.off('online', this.handleNetworkOnline);
        console.log('SyncEngine stopped');
    }
    async processPendingOutbox() {
        if (this.isSyncing)
            return;
        if (!networkMonitor_1.networkMonitor.isOnline)
            return;
        const apiUrl = (0, apiConfig_1.getApiBaseUrl)();
        if (!apiUrl) {
            // Skip sync only if API URL is not configured.
            return;
        }
        this.isSyncing = true;
        try {
            const pendingRows = db_1.default.prepare(`
        SELECT * FROM sync_outbox 
        WHERE status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT 50
      `).all();
            const nowMs = Date.now();
            const readyRows = pendingRows
                .filter((row) => {
                if (!row.last_attempted_at)
                    return true;
                const lastAttemptMs = new Date(row.last_attempted_at).getTime();
                if (!Number.isFinite(lastAttemptMs))
                    return true;
                return nowMs - lastAttemptMs >= this.getRetryDelayMs(Number(row.attempt_count || 0));
            })
                .slice(0, 10);
            if (readyRows.length === 0) {
                this.isSyncing = false;
                return;
            }
            logger_1.default.info(`SyncEngine attempting to push ${readyRows.length} outbox entries to cloud.`);
            const deviceInfo = (0, deviceInfo_1.getDeviceInfo)();
            const syncHeaders = (0, apiConfig_1.getSyncHeaders)(deviceInfo.deviceId);
            if (!syncHeaders) {
                console.warn('Cloud sync skipped because SYNC_DEVICE_SECRET is not configured.');
                this.isSyncing = false;
                return;
            }
            for (const row of readyRows) {
                try {
                    const response = await (0, apiConfig_1.fetchWithTimeout)(`${apiUrl}/sync/ingest`, {
                        method: 'POST',
                        headers: syncHeaders,
                        body: JSON.stringify({
                            table: row.table_name,
                            operation: row.operation,
                            recordId: row.record_id,
                            payload: JSON.parse(row.payload),
                            timestamp: row.created_at,
                            device: {
                                id: deviceInfo.deviceId,
                                name: deviceInfo.deviceName,
                                terminalNumber: deviceInfo.terminalNumber
                            }
                        })
                    }, 15000);
                    if (response.ok) {
                        db_1.default.prepare(`UPDATE sync_outbox SET status = 'synced', error_message = NULL WHERE id = ?`).run(row.id);
                        logger_1.default.info(`SyncEngine successfully uploaded row ${row.id} for table '${row.table_name}'.`);
                    }
                    else {
                        const errText = await response.text();
                        throw new Error(`Server Error (${response.status}): ${errText.substring(0, 500)}`);
                    }
                }
                catch (error) {
                    logger_1.default.warn(`SyncEngine outbox upload failed for row ${row.id}: ${error.message}`);
                    db_1.default.prepare(`
            UPDATE sync_outbox 
            SET attempt_count = attempt_count + 1, 
                error_message = ?, 
                last_attempted_at = datetime('now')
            WHERE id = ?
          `).run(error.message, row.id);
                    const updated = db_1.default.prepare(`SELECT attempt_count FROM sync_outbox WHERE id = ?`).get(row.id);
                    if (updated && updated.attempt_count >= 10) {
                        db_1.default.prepare(`UPDATE sync_outbox SET status = 'failed' WHERE id = ?`).run(row.id);
                    }
                    // Stop processing further rows in this batch if one fails (likely network/server issue)
                    break;
                }
            }
        }
        catch (e) {
            console.error('Critical sync engine error:', e);
        }
        finally {
            this.isSyncing = false;
        }
    }
}
exports.SyncEngine = SyncEngine;
