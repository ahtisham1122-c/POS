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
    const row = db.prepare('SELECT * FROM daily_rates WHERE date = ?').get(today) as any;
    if (row) return row;
    return db.prepare('SELECT * FROM daily_rates ORDER BY date DESC LIMIT 1').get() || null;
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
        `).run(
          milkRate,
          yogurtRate,
          user.id,
          date
        );
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
        `).run(
          id,
          date,
          milkRate,
          yogurtRate,
          user.id,
          now
        );
        createOutboxEntry('daily_rates', 'INSERT', id, {
          id,
          date,
          milk_rate: milkRate,
          yogurt_rate: yogurtRate,
          updated_by_id: user.id,
          created_at: now
        });
      }

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
