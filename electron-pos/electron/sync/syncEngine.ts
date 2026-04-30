import db from '../database/db';
import { networkMonitor } from './networkMonitor';
import { fetchWithTimeout, getApiBaseUrl, getSyncHeaders } from './apiConfig';
import { getDeviceInfo } from './deviceInfo';
import logger from '../utils/logger';



export class SyncEngine {
  private interval: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private readonly handleNetworkOnline = () => {
    console.log('Network is back online, triggering sync');
    this.processPendingOutbox();
  };

  private getRetryDelayMs(attemptCount: number) {
    const minutes = [1, 2, 5, 15, 30, 60][Math.min(Math.max(attemptCount, 0), 5)];
    return minutes * 60 * 1000;
  }

  start() {
    if (this.interval) return;
    console.log('SyncEngine started');
    this.interval = setInterval(() => this.processPendingOutbox(), 5000);
    networkMonitor.on('online', this.handleNetworkOnline);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    networkMonitor.off('online', this.handleNetworkOnline);
    console.log('SyncEngine stopped');
  }

  async processPendingOutbox() {
    if (this.isSyncing) return;
    if (!networkMonitor.isOnline) return;

    const apiUrl = getApiBaseUrl();
    if (!apiUrl) {
      // Skip sync only if API URL is not configured.
      return;
    }

    this.isSyncing = true;
    try {
      const pendingRows = db.prepare(`
        SELECT * FROM sync_outbox 
        WHERE status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT 50
      `).all() as any[];

      const nowMs = Date.now();
      const readyRows = pendingRows
        .filter((row) => {
          if (!row.last_attempted_at) return true;
          const lastAttemptMs = new Date(row.last_attempted_at).getTime();
          if (!Number.isFinite(lastAttemptMs)) return true;
          return nowMs - lastAttemptMs >= this.getRetryDelayMs(Number(row.attempt_count || 0));
        })
        .slice(0, 10);

      if (readyRows.length === 0) {
        this.isSyncing = false;
        return;
      }

      logger.info(`SyncEngine attempting to push ${readyRows.length} outbox entries to cloud.`);


      const deviceInfo = getDeviceInfo();
      const syncHeaders = getSyncHeaders(deviceInfo.deviceId);
      if (!syncHeaders) {
        console.warn('Cloud sync skipped because SYNC_DEVICE_SECRET is not configured.');
        this.isSyncing = false;
        return;
      }

      for (const row of readyRows) {
        // Network-level error flag — if true, abort the entire batch
        let networkError = false;

        try {
          let response: Response;
          try {
            response = await fetchWithTimeout(`${apiUrl}/sync/ingest`, {
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
          } catch (fetchErr: any) {
            // fetch() itself threw — network is down or server unreachable
            networkError = true;
            throw fetchErr;
          }

          if (response.ok) {
            const result = await response.json() as any;
            const action = result?.data?.action ?? result?.action;
            const reason = result?.data?.reason ?? result?.reason ?? '';

            if (action === 'skipped' && typeof reason === 'string' && reason.startsWith('Missing parent')) {
              // Parent not synced yet — keep pending so it retries after parent arrives
              db.prepare(`
                UPDATE sync_outbox
                SET attempt_count = attempt_count + 1,
                    error_message = ?,
                    last_attempted_at = datetime('now')
                WHERE id = ?
              `).run(`Waiting for parent: ${reason}`, row.id);
              logger.info(`SyncEngine deferred row ${row.id} (${row.table_name}): ${reason}`);
            } else {
              db.prepare(`UPDATE sync_outbox SET status = 'synced', error_message = NULL WHERE id = ?`).run(row.id);
              logger.info(`SyncEngine synced row ${row.id} for table '${row.table_name}' (action: ${action}).`);
            }
          } else {
            // Server returned an HTTP error for this specific row — record the error and
            // continue with the next row (don't abort the batch).
            const errText = await response.text();
            const errMsg = `Server Error (${response.status}): ${errText.substring(0, 300)}`;
            logger.warn(`SyncEngine server rejected row ${row.id} (${row.table_name}): ${errMsg}`);

            db.prepare(`
              UPDATE sync_outbox
              SET attempt_count = attempt_count + 1,
                  error_message = ?,
                  last_attempted_at = datetime('now')
              WHERE id = ?
            `).run(errMsg, row.id);

            const updated = db.prepare(`SELECT attempt_count FROM sync_outbox WHERE id = ?`).get(row.id) as any;
            if (updated && updated.attempt_count >= 10) {
              db.prepare(`UPDATE sync_outbox SET status = 'failed' WHERE id = ?`).run(row.id);
            }
          }

        } catch (error: any) {
          logger.warn(`SyncEngine outbox upload failed for row ${row.id}: ${error.message}`);

          db.prepare(`
            UPDATE sync_outbox
            SET attempt_count = attempt_count + 1,
                error_message = ?,
                last_attempted_at = datetime('now')
            WHERE id = ?
          `).run(error.message, row.id);

          const updated = db.prepare(`SELECT attempt_count FROM sync_outbox WHERE id = ?`).get(row.id) as any;
          if (updated && updated.attempt_count >= 10) {
            db.prepare(`UPDATE sync_outbox SET status = 'failed' WHERE id = ?`).run(row.id);
          }

          if (networkError) {
            // Network is down — no point trying the remaining rows in this batch
            break;
          }
          // Otherwise it was a row-level error — continue with next row
        }
      }
    } catch (e) {
      console.error('Critical sync engine error:', e);
    } finally {
      this.isSyncing = false;
    }
  }
}
