import db from '../database/db';

function getDefaultApiBaseUrl() {
  return process.env.APP_API_URL || 'http://localhost:3001/api';
}

function isSupabaseRestUrl(value: string) {
  const normalized = value.toLowerCase();
  return normalized.includes('supabase.co') || normalized.includes('/rest/v1');
}

function normalizeApiBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed || isSupabaseRestUrl(trimmed)) return getDefaultApiBaseUrl();
  return trimmed;
}

export function getApiBaseUrl() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'APP_API_URL'").get() as any;
    if (row?.value) {
      const normalized = normalizeApiBaseUrl(row.value);
      if (normalized !== row.value) {
        db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'APP_API_URL'")
          .run(normalized, new Date().toISOString());
      }
      return normalized;
    }
  } catch (e) {
    console.error('Error reading APP_API_URL from settings:', e);
  }
  return getDefaultApiBaseUrl();
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
