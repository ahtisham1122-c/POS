import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { getCurrentUser } from './auth.ipc';
import { getCashRegisterExpected } from '../database/cashRegister';
import { formatLocalDate, getActiveBusinessDate, getOpenShift } from '../database/businessDay';
import { performBackup } from '../sync/backup';

export function registerCashRegisterIPC() {
  ipcMain.handle('cashRegister:getToday', () => {
    const openShift = getOpenShift();
    const date = openShift?.shift_date || getActiveBusinessDate();
    const { register, openingCash, cashIn, cashOut, expectedCash } = getCashRegisterExpected(date, openShift?.id);
    if (!register) return null;
    return {
      ...register,
      shift_id: register.shift_id || openShift?.id || null,
      opening_cash: openingCash,
      cash_in_total: cashIn,
      cash_out_total: cashOut,
      expected_cash: expectedCash
    };
  });

  ipcMain.handle('cashRegister:open', (_event, data: any) => {
    try {
      const now = new Date().toISOString();
      const openShift = getOpenShift();
      const date = openShift?.shift_date || formatLocalDate(new Date());
      const existing = openShift
        ? db.prepare('SELECT * FROM cash_register WHERE shift_id = ?').get(openShift.id) as any
        : db.prepare('SELECT * FROM cash_register WHERE date = ? AND is_closed_for_day = 0').get(date) as any;
      if (existing) return { success: false, error: 'Cash register is already opened for today' };

      const id = crypto.randomUUID();
      const openingBalance = Number(data?.openingBalance || 0);
      db.prepare(`
        INSERT INTO cash_register (id, shift_id, date, opening_balance, cash_in, cash_out, closing_balance, is_closed_for_day, created_at, synced)
        VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, 0)
      `).run(id, openShift?.id || null, date, openingBalance, openingBalance, now);

      createOutboxEntry('cash_register', 'INSERT', id, {
        id,
        shift_id: openShift?.id || null,
        date,
        opening_balance: openingBalance,
        cash_in: 0,
        cash_out: 0,
        closing_balance: openingBalance,
        is_closed_for_day: 0,
        created_at: now
      });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('cashRegister:close', (_event, data: { closingBalance: number; notes?: string }) => {
    try {
      const now = new Date().toISOString();
      const openShift = getOpenShift();
      const date = openShift?.shift_date || getActiveBusinessDate();
      const row = openShift
        ? db.prepare('SELECT * FROM cash_register WHERE shift_id = ? OR (shift_id IS NULL AND date = ?) ORDER BY created_at DESC LIMIT 1').get(openShift.id, date) as any
        : db.prepare('SELECT * FROM cash_register WHERE date = ? ORDER BY created_at DESC LIMIT 1').get(date) as any;
      if (!row) return { success: false, error: 'Cash register is not opened for today' };
      if (Number(row.is_closed_for_day) === 1) return { success: false, error: 'Cash register is already closed' };

      const physicalCash = Number(data.closingBalance);
      if (!Number.isFinite(physicalCash) || physicalCash < 0) {
        return { success: false, error: 'Please enter a valid counted cash amount' };
      }

      const { expectedCash } = getCashRegisterExpected(date, openShift?.id);
      const variance = Number((physicalCash - expectedCash).toFixed(2));
      const closeNotes = String(data.notes || '').trim();

      db.prepare(`
        UPDATE cash_register
        SET closing_balance = ?, is_closed_for_day = 1, synced = 0
        WHERE id = ?
      `).run(physicalCash, row.id);

      createOutboxEntry('cash_register', 'UPDATE', row.id, {
        id: row.id,
        shift_id: openShift?.id || row.shift_id || null,
        date,
        closing_balance: physicalCash,
        is_closed_for_day: 1,
        updated_at: now
      });

      if (openShift) {
        const closedById = getCurrentUser()?.id || 'system';
        db.prepare(`
          UPDATE shifts
          SET closed_by_id = ?, closed_at = ?, expected_cash = ?, closing_cash = ?,
              cash_variance = ?, receipt_audit_session_id = NULL, status = 'CLOSED',
              notes = ?, synced = 0
          WHERE id = ?
        `).run(closedById, now, expectedCash, physicalCash, variance, closeNotes || openShift.notes || null, openShift.id);

        createOutboxEntry('shifts', 'UPDATE', openShift.id, {
          id: openShift.id,
          closed_by_id: closedById,
          closed_at: now,
          expected_cash: expectedCash,
          closing_cash: physicalCash,
          cash_variance: variance,
          receipt_audit_session_id: null,
          status: 'CLOSED',
          notes: closeNotes || openShift.notes || null
        });
      }

      performBackup(false);

      return { success: true, closingBalance: physicalCash, expectedCash, variance };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('cashRegister:getHistory', () => {
    return (db.prepare('SELECT * FROM cash_register ORDER BY date DESC LIMIT 30').all() as any[]).map((row) => {
      const openingCash = Number(row.opening_balance || 0);
      const cashIn = Number(row.cash_in || 0);
      const cashOut = Number(row.cash_out || 0);
      const expectedCash = Number((openingCash + cashIn - cashOut).toFixed(2));
      return {
        ...row,
        expected_cash: expectedCash,
        cash_variance: Number(row.is_closed_for_day) === 1
          ? Number((Number(row.closing_balance || 0) - expectedCash).toFixed(2))
          : null
      };
    });
  });
}
