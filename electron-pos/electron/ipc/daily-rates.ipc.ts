import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { requireCurrentUser, requireManagerApproval } from './auth.ipc';
import { logAudit } from '../audit/auditLog';
import { getBusinessDate } from '../database/businessDay';

function requirePositiveRate(value: unknown, fieldName: string) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return rate;
}

export function registerDailyRatesIPC() {
  ipcMain.handle('dailyRates:getToday', () => {
    const today = getBusinessDate();
    return db.prepare('SELECT * FROM daily_rates WHERE date = ?').get(today) || null;
  });

  ipcMain.handle('dailyRates:getLatest', () => {
    return db.prepare('SELECT * FROM daily_rates ORDER BY date DESC LIMIT 1').get() || null;
  });

  ipcMain.handle('dailyRates:getHistory', () => {
    return db.prepare(`
      SELECT dr.*, u.name as updated_by_name
      FROM daily_rates dr
      LEFT JOIN users u ON u.id = dr.updated_by_id
      ORDER BY dr.date DESC
      LIMIT 30
    `).all();
  });

  ipcMain.handle('dailyRates:getRateChangeHistory', (_event, limit = 100) => {
    return db.prepare(`
      SELECT *
      FROM rate_change_history
      ORDER BY changed_at DESC
      LIMIT ?
    `).all(limit);
  });

  ipcMain.handle('dailyRates:update', (_event, data: any) => {
    try {
      const user = requireCurrentUser();
      const approver = requireManagerApproval(data.managerPin, 'changing daily rates');
      const now = new Date().toISOString();
      const date = data.date || getBusinessDate();
      const existing = db.prepare('SELECT * FROM daily_rates WHERE date = ?').get(date) as any;
      const id = existing?.id || crypto.randomUUID();
      const milkRate = requirePositiveRate(data.milkRate, 'Milk rate');
      const yogurtRate = requirePositiveRate(data.yogurtRate, 'Yogurt rate');

      if (existing) {
        db.prepare(`
          UPDATE daily_rates
          SET milk_rate = ?, yogurt_rate = ?, updated_by_id = ?, synced = 0
          WHERE date = ?
        `).run(milkRate, yogurtRate, user.id, date);
        createOutboxEntry('daily_rates', 'UPDATE', id, {
          id,
          date,
          milk_rate: milkRate,
          yogurt_rate: yogurtRate,
          updated_by_id: user.id,
          created_at: existing.created_at
        });
      } else {
        db.prepare(`
          INSERT INTO daily_rates (id, date, milk_rate, yogurt_rate, updated_by_id, created_at, synced)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(id, date, milkRate, yogurtRate, user.id, now);
        createOutboxEntry('daily_rates', 'INSERT', id, {
          id,
          date,
          milk_rate: milkRate,
          yogurt_rate: yogurtRate,
          updated_by_id: user.id,
          created_at: now
        });
      }

      // Sync selling price on Milk and Yogurt products so POS always uses the current rate
      const milkProduct = db.prepare(`SELECT id FROM products WHERE code = 'MILK' AND is_active = 1`).get() as any;
      const yogurtProduct = db.prepare(`SELECT id FROM products WHERE code = 'YOGT' AND is_active = 1`).get() as any;
      if (milkProduct) {
        db.prepare(`UPDATE products SET selling_price = ?, updated_at = ?, synced = 0 WHERE id = ?`).run(milkRate, now, milkProduct.id);
      }
      if (yogurtProduct) {
        db.prepare(`UPDATE products SET selling_price = ?, updated_at = ?, synced = 0 WHERE id = ?`).run(yogurtRate, now, yogurtProduct.id);
      }

      const upsertSetting = db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      upsertSetting.run('milk_rate', String(milkRate), now);
      upsertSetting.run('yogurt_rate', String(yogurtRate), now);

      // Record every rate change in history (even multiple changes in the same day)
      const historyId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO rate_change_history (
          id, changed_at, milk_rate_old, milk_rate_new, yogurt_rate_old, yogurt_rate_new,
          changed_by_id, changed_by_name, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        historyId,
        now,
        existing ? existing.milk_rate : null,
        milkRate,
        existing ? existing.yogurt_rate : null,
        yogurtRate,
        user.id,
        user.name || user.username || null,
        data.notes || null,
        now
      );

      logAudit({
        actionType: 'DAILY_RATES_CHANGED',
        entityType: 'daily_rates',
        entityId: id,
        before: existing ? { milkRate: existing.milk_rate, yogurtRate: existing.yogurt_rate } : null,
        after: { milkRate, yogurtRate, date },
        approvedBy: approver
      });

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
