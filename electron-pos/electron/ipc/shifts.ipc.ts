import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { getCurrentUser } from './auth.ipc';
import { getCashRegisterExpected } from '../database/cashRegister';
import { getBusinessDate } from '../database/businessDay';
import { performBackup } from '../sync/backup';

function getLatestReceiptAudit(date: string) {
  return db.prepare(`
    SELECT *
    FROM receipt_audit_sessions
    WHERE audit_date = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(date) as any;
}

export function registerShiftsIPC() {
  ipcMain.handle('shifts:getCurrent', () => {
    return db.prepare(`
      SELECT s.*, opener.name as opened_by_name, closer.name as closed_by_name
      FROM shifts s
      LEFT JOIN users opener ON opener.id = s.opened_by_id
      LEFT JOIN users closer ON closer.id = s.closed_by_id
      WHERE s.status = 'OPEN'
      ORDER BY s.opened_at DESC
      LIMIT 1
    `).get() || null;
  });

  ipcMain.handle('shifts:getToday', () => {
    return db.prepare(`
      SELECT s.*, opener.name as opened_by_name, closer.name as closed_by_name
      FROM shifts s
      LEFT JOIN users opener ON opener.id = s.opened_by_id
      LEFT JOIN users closer ON closer.id = s.closed_by_id
      WHERE s.shift_date = ?
      ORDER BY s.opened_at DESC
      LIMIT 1
    `).get(getBusinessDate()) || null;
  });

  ipcMain.handle('shifts:open', (_event, data: { openingCash: number; notes?: string }) => {
    try {
      return db.transaction(() => {
        const existingOpen = db.prepare("SELECT id FROM shifts WHERE status = 'OPEN' LIMIT 1").get() as any;
        if (existingOpen) {
          return { success: false, error: 'A shift is already open' };
        }

        const now = new Date().toISOString();
        const date = getBusinessDate();
        const user = getCurrentUser();
        const openedById = user?.id || 'system';
        const openingCash = Number(data?.openingCash || 0);
        if (!Number.isFinite(openingCash) || openingCash < 0) {
          return { success: false, error: 'Opening cash must be zero or more' };
        }
        const shiftId = crypto.randomUUID();

        const existingRegister = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(date) as any;
        if (!existingRegister) {
          const registerId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO cash_register (id, date, opening_balance, cash_in, cash_out, closing_balance, is_closed_for_day, created_at, synced)
            VALUES (?, ?, ?, 0, 0, ?, 0, ?, 0)
          `).run(registerId, date, openingCash, openingCash, now);

          createOutboxEntry('cash_register', 'INSERT', registerId, {
            id: registerId,
            date,
            opening_balance: openingCash,
            cash_in: 0,
            cash_out: 0,
            closing_balance: openingCash,
            is_closed_for_day: 0,
            created_at: now
          });
        }

        db.prepare(`
          INSERT INTO shifts (
            id, shift_date, opened_by_id, opened_at, opening_cash,
            expected_cash, status, notes, synced
          ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, 0)
        `).run(shiftId, date, openedById, now, openingCash, openingCash, data?.notes || null);

        createOutboxEntry('shifts', 'INSERT', shiftId, {
          id: shiftId,
          shift_date: date,
          opened_by_id: openedById,
          opened_at: now,
          opening_cash: openingCash,
          expected_cash: openingCash,
          status: 'OPEN',
          notes: data?.notes || null
        });

        return { success: true, shiftId };
      })();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('shifts:close', (_event, data: { closingCash: number; notes?: string }) => {
    try {
      const result = db.transaction(() => {
        const shift = db.prepare("SELECT * FROM shifts WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get() as any;
        if (!shift) return { success: false, error: 'No open shift found' };

        const receiptAudit = getLatestReceiptAudit(shift.shift_date);
        if (!receiptAudit) {
          return {
            success: false,
            requiresReceiptAudit: true,
            error: 'Please complete Receipt Audit before closing the shift'
          };
        }

        const now = new Date().toISOString();
        const closedById = getCurrentUser()?.id || 'system';
        const expectedCash = getCashRegisterExpected(shift.shift_date).expectedCash;
        const closingCash = Number(data?.closingCash || 0);
        if (!Number.isFinite(closingCash) || closingCash < 0) {
          return { success: false, error: 'Closing cash must be zero or more' };
        }
        const variance = Number((closingCash - expectedCash).toFixed(2));
        const register = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(shift.shift_date) as any;
        if (!register) {
          return { success: false, error: 'Cash register was not opened for this shift date' };
        }
        if (Number(register.is_closed_for_day || 0) === 1) {
          return { success: false, error: 'Cash register is already closed for this date' };
        }

        db.prepare(`
          UPDATE shifts
          SET closed_by_id = ?, closed_at = ?, expected_cash = ?, closing_cash = ?,
              cash_variance = ?, receipt_audit_session_id = ?, status = 'CLOSED',
              notes = ?, synced = 0
          WHERE id = ?
        `).run(
          closedById,
          now,
          expectedCash,
          closingCash,
          variance,
          receiptAudit.id,
          data?.notes || shift.notes || null,
          shift.id
        );

        db.prepare(`
          UPDATE cash_register
          SET closing_balance = ?, is_closed_for_day = 1, synced = 0
          WHERE id = ?
        `).run(closingCash, register.id);

        createOutboxEntry('shifts', 'UPDATE', shift.id, {
          id: shift.id,
          closed_by_id: closedById,
          closed_at: now,
          expected_cash: expectedCash,
          closing_cash: closingCash,
          cash_variance: variance,
          receipt_audit_session_id: receiptAudit.id,
          status: 'CLOSED',
          notes: data?.notes || shift.notes || null
        });

        createOutboxEntry('cash_register', 'UPDATE', register.id, {
          id: register.id,
          date: shift.shift_date,
          closing_balance: closingCash,
          is_closed_for_day: 1,
          updated_at: now
        });

        return { success: true, expectedCash, closingCash, variance };
      })();

      if (result?.success) {
        performBackup(false);
      }

      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('shifts:getHistory', (_event, limit = 30) => {
    return db.prepare(`
      SELECT s.*, opener.name as opened_by_name, closer.name as closed_by_name
      FROM shifts s
      LEFT JOIN users opener ON opener.id = s.opened_by_id
      LEFT JOIN users closer ON closer.id = s.closed_by_id
      ORDER BY s.opened_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 30, 100)));
  });
}
