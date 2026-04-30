import db from '../database/db';
import { fetchWithTimeout, getApiBaseUrl, getRegistrationHeaders } from './apiConfig';
import { getDeviceInfo } from './deviceInfo';
import log from '../utils/logger';

export async function registerDeviceWithCloud() {
  const info = getDeviceInfo();
  const apiUrl = getApiBaseUrl();
  const syncHeaders = getRegistrationHeaders(info.deviceId);
  if (!syncHeaders) {
    log.warn('Cloud device registration skipped because SYNC_DEVICE_SECRET is not configured.');
    return { success: false, skipped: true, error: 'SYNC_DEVICE_SECRET is not configured.' };
  }

  const response = await fetchWithTimeout(`${apiUrl}/sync/register-device`, {
    method: 'POST',
    headers: syncHeaders,
    body: JSON.stringify(info)
  }, 15000);
  if (!response.ok) {
    throw new Error(`Device registration failed with status ${response.status}`);
  }

  const parsed: any = await response.json();
  const payload = parsed?.success ? parsed.data : parsed;
  const syncToken = String(payload?.syncToken || '').trim();
  if (!syncToken) {
    throw new Error('Device registration did not return a sync token');
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('SYNC_DEVICE_TOKEN', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(syncToken, now);

  log.info('Registered device with cloud.');
  return { success: true };
}
