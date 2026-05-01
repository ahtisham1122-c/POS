import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { getCurrentUser, requireCurrentUser } from './auth.ipc';
import { logAudit } from '../audit/auditLog';
import { getSyncSecretValidationError, normalizeSyncSecret } from '../sync/secretValidation';
import { getBusinessDate } from '../database/businessDay';
import { createOutboxEntry } from '../sync/outboxHelper';

const SETUP_ALLOWED_KEYS = new Set(['shop_name', 'shop_address', 'shop_phone', 'milk_rate', 'yogurt_rate']);
const REDACTED_SETTING_KEYS = new Set(['SYNC_DEVICE_SECRET', 'SYNC_DEVICE_TOKEN']);

function redactSettingsForAudit(settings: Record<string, any>) {
  return Object.entries(settings).reduce<Record<string, any>>((acc, [key, value]) => {
    acc[key] = REDACTED_SETTING_KEYS.has(key) ? '[REDACTED]' : value;
    return acc;
  }, {});
}

function isSetupCompleted() {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'setup_completed'").get() as any;
  return String(setting?.value || '').toLowerCase() === 'true';
}

function parsePositiveRate(value: unknown, fieldName: string) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return rate;
}

function syncSetupRatesToDailyRates(payload: Record<string, any>, userId?: string) {
  if (payload.milk_rate === undefined && payload.yogurt_rate === undefined) return;

  const existingLatest = db.prepare('SELECT * FROM daily_rates ORDER BY date DESC LIMIT 1').get() as any;
  const milkRate = parsePositiveRate(payload.milk_rate ?? existingLatest?.milk_rate, 'Milk rate');
  const yogurtRate = parsePositiveRate(payload.yogurt_rate ?? existingLatest?.yogurt_rate, 'Yogurt rate');
  const date = getBusinessDate();
  const now = new Date().toISOString();
  const existingToday = db.prepare('SELECT * FROM daily_rates WHERE date = ?').get(date) as any;
  const id = existingToday?.id || crypto.randomUUID();
  const updatedById = userId || existingToday?.updated_by_id || existingLatest?.updated_by_id || 'admin-id';

  if (existingToday) {
    db.prepare(`
      UPDATE daily_rates
      SET milk_rate = ?, yogurt_rate = ?, updated_by_id = ?, synced = 0
      WHERE id = ?
    `).run(milkRate, yogurtRate, updatedById, id);
    createOutboxEntry('daily_rates', 'UPDATE', id, {
      id,
      date,
      milk_rate: milkRate,
      yogurt_rate: yogurtRate,
      updated_by_id: updatedById,
      created_at: existingToday.created_at
    });
  } else {
    db.prepare(`
      INSERT INTO daily_rates (id, date, milk_rate, yogurt_rate, updated_by_id, created_at, synced)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(id, date, milkRate, yogurtRate, updatedById, now);
    createOutboxEntry('daily_rates', 'INSERT', id, {
      id,
      date,
      milk_rate: milkRate,
      yogurt_rate: yogurtRate,
      updated_by_id: updatedById,
      created_at: now
    });
  }

  const updateProductRate = db.prepare(`
    UPDATE products
    SET selling_price = ?, updated_at = ?, synced = 0
    WHERE code = ? AND is_active = 1
  `);
  updateProductRate.run(milkRate, now, 'MILK');
  updateProductRate.run(yogurtRate, now, 'YOGT');
}

export function registerSettingsIPC() {
  ipcMain.handle('settings:getAll', () => {
    return db.prepare("SELECT key, value, updated_at FROM settings WHERE key <> 'SYNC_DEVICE_TOKEN' ORDER BY key ASC").all();
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

      delete payload.SYNC_DEVICE_TOKEN;
      if (payload.SYNC_DEVICE_SECRET !== undefined || payload.APP_API_URL !== undefined) {
        requireCurrentUser(['ADMIN']);
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
        syncSetupRatesToDailyRates(payload, currentUser?.id);
      });
      tx(payload);
      logAudit({
        actionType: 'SETTINGS_CHANGED',
        entityType: 'settings',
        before: redactSettingsForAudit(beforeSettings.reduce<Record<string, string>>((acc, row) => {
          acc[row.key] = row.value;
          return acc;
        }, {})),
        after: redactSettingsForAudit(payload)
      });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
