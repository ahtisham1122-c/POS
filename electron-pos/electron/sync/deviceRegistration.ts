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
    let bodyText = '';
    try { bodyText = (await response.text()).substring(0, 200); } catch {}
    throw new Error(
      `Device registration failed with status ${response.status}` +
      (bodyText ? `: ${bodyText}` : '')
    );
  }

  // The server may return non-JSON if a misconfigured proxy / Nginx error page
  // is in front of the API. Guard the parse so the cashier sees a clear
  // diagnostic instead of "Unexpected token < in JSON".
  let parsed: any;
  try {
    parsed = await response.json();
  } catch (jsonErr: any) {
    throw new Error(
      `Cloud responded with non-JSON content. Check your APP_API_URL and that Nginx is proxying /api correctly. (${jsonErr?.message || jsonErr})`
    );
  }

  const payload = parsed?.success ? parsed.data : parsed;
  const syncToken = String(payload?.syncToken || '').trim();
  if (!syncToken) {
    // Most common cause: the deployed backend is older than the per-device
    // token migration (commit d3d9ed8). Old backend says success but doesn't
    // return a token — we'd then have nothing to authenticate sync calls
    // with. Tell the user exactly what to do.
    throw new Error(
      'Cloud server registered the device but did not return a sync token. ' +
      'The backend on the VPS is out of date — please redeploy the latest ' +
      'noon-dairy-backend (commit d3d9ed8 or newer).'
    );
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
