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
    if (!apiUrl || apiUrl.includes('localhost')) {
      // Skip sync if API URL is not configured or pointing to localhost (dev default)
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

      const isSupabase = apiUrl.includes('supabase.co');
      const supabaseKeySetting = db.prepare("SELECT value FROM settings WHERE key = 'SYNC_DEVICE_SECRET'").get() as any;
      const actualSupabaseKey = supabaseKeySetting?.value || process.env.SYNC_DEVICE_SECRET;

      for (const row of readyRows) {
        try {
          let response;
          if (isSupabase && actualSupabaseKey) {
            let baseRestUrl = apiUrl;
            if (!baseRestUrl.includes('/rest/v1')) {
              baseRestUrl = `${baseRestUrl.replace(/\/$/, '')}/rest/v1`;
            }

            const payloadObj = JSON.parse(row.payload);
            
            if (row.operation === 'DELETE') {
              response = await fetchWithTimeout(`${baseRestUrl}/${row.table_name}?id=eq.${row.record_id}`, {
                method: 'DELETE',
                headers: {
                  'apikey': actualSupabaseKey,
                  'Authorization': `Bearer ${actualSupabaseKey}`
                }
              }, 15000);
            } else {
              // Upsert logic for INSERT/UPDATE
              response = await fetchWithTimeout(`${baseRestUrl}/${row.table_name}`, {
                method: 'POST',
                headers: {
                  'apikey': actualSupabaseKey,
                  'Authorization': `Bearer ${actualSupabaseKey}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify(payloadObj)
              }, 15000);
            }
          } else {
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
          }

          if (response.ok) {
            db.prepare(`UPDATE sync_outbox SET status = 'synced', error_message = NULL WHERE id = ?`).run(row.id);
            logger.info(`SyncEngine successfully uploaded row ${row.id} for table '${row.table_name}'.`);
          } else {
            const errText = await response.text();
            throw new Error(`Server Error (${response.status}): ${errText.substring(0, 50)}`);
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
          // Stop processing further rows in this batch if one fails (likely network/server issue)
          break;
        }
      }
    } catch (e) {
      console.error('Critical sync engine error:', e);
    } finally {
      this.isSyncing = false;
    }
  }
}
