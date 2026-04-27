import db from '../database/db';

export function getApiBaseUrl() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'APP_API_URL'").get() as any;
    if (row?.value) return row.value;
  } catch (e) {
    console.error('Error reading APP_API_URL from settings:', e);
  }
  return process.env.APP_API_URL || 'http://localhost:3001/api';
}

export function getSyncHeaders(deviceId?: string) {
  let syncSecret = process.env.SYNC_DEVICE_SECRET;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'SYNC_DEVICE_SECRET'").get() as any;
    if (row?.value) syncSecret = row.value;
  } catch (e) {
    console.error('Error reading SYNC_DEVICE_SECRET from settings:', e);
  }
  if (!syncSecret) return null;

  return {
    'Content-Type': 'application/json',
    'X-Sync-Secret': syncSecret,
    ...(deviceId ? { 'X-Device-Id': deviceId } : {})
  };
}

export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}
