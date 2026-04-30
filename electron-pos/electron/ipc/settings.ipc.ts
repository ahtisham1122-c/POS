import { ipcMain } from 'electron';
import db from '../database/db';
import { getCurrentUser, requireCurrentUser } from './auth.ipc';
import { logAudit } from '../audit/auditLog';
import { getSyncSecretValidationError, normalizeSyncSecret } from '../sync/secretValidation';

const SETUP_ALLOWED_KEYS = new Set(['shop_name', 'shop_address', 'shop_phone', 'milk_rate', 'yogurt_rate']);

function isSetupCompleted() {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'setup_completed'").get() as any;
  return String(setting?.value || '').toLowerCase() === 'true';
}

export function registerSettingsIPC() {
  ipcMain.handle('settings:getAll', () => {
    return db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key ASC').all();
  });

  ipcMain.handle('settings:update', (_event, data: Record<string, any>) => {
    try {
      const payload = { ...(data || {}) };
      const currentUser = getCurrentUser();
      if (!currentUser) {
        const setupMode = !isSetupCompleted();
        const keys = Object.keys(payload);
        const setupOnlyPayload = keys.length > 0 && keys.every((key) => SETUP_ALLOWED_KEYS.has(key));
        if (!setupMode || !setupOnlyPayload) {
          requireCurrentUser(['ADMIN', 'MANAGER']);
        }
      } else {
        requireCurrentUser(['ADMIN', 'MANAGER']);
      }

      if (payload.taxRate !== undefined) {
        const rate = Number(payload.taxRate);
        if (!Number.isFinite(rate) || rate < 0) {
          throw new Error('Tax rate must be zero or more');
        }
        payload.taxRate = String(rate);
      }
      if (payload.taxLabel !== undefined) {
        const label = String(payload.taxLabel || '').trim();
        if (!label) {
          throw new Error('Tax label is required');
        }
        payload.taxLabel = label;
      }
      if (payload.shopDayStartHour !== undefined) {
        const hour = Number(payload.shopDayStartHour);
        if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
          throw new Error('Shop day start hour must be between 0 and 23');
        }
        payload.shopDayStartHour = String(Math.floor(hour));
      }
      if (payload.ramadan24Hour !== undefined) {
        payload.ramadan24Hour = String(String(payload.ramadan24Hour).toLowerCase() === 'true');
        payload['24_hour_mode'] = payload.ramadan24Hour;
      }
      if (payload['24_hour_mode'] !== undefined) {
        payload['24_hour_mode'] = String(String(payload['24_hour_mode']).toLowerCase() === 'true');
        payload.ramadan24Hour = payload['24_hour_mode'];
      }
      if (payload.SYNC_DEVICE_SECRET !== undefined) {
        payload.SYNC_DEVICE_SECRET = normalizeSyncSecret(payload.SYNC_DEVICE_SECRET);
        const secretError = getSyncSecretValidationError(payload.SYNC_DEVICE_SECRET, true);
        if (secretError) {
          throw new Error(secretError);
        }
      }
      const now = new Date().toISOString();
      const beforeSettings = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
      const statement = db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      const tx = db.transaction((payload: Record<string, any>) => {
        Object.entries(payload || {}).forEach(([key, value]) => {
          statement.run(key, String(value ?? ''), now);
        });
      });
      tx(payload);
      logAudit({
        actionType: 'SETTINGS_CHANGED',
        entityType: 'settings',
        before: beforeSettings.reduce<Record<string, string>>((acc, row) => {
          acc[row.key] = row.value;
          return acc;
        }, {}),
        after: payload
      });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
