import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { getCurrentUser } from './auth.ipc';
import { getCashRegisterExpected } from '../database/cashRegister';
import { formatLocalDate, getActiveBusinessDate, shouldWarnBeforeOpeningShift } from '../database/businessDay';
import { performBackup } from '../sync/backup';

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
    `).get(getActiveBusinessDate()) || null;
  });

  ipcMain.handle('shifts:open', (_event, data: { openingCash: number; notes?: string; confirmAfterMidnightOpen?: boolean }) => {
    try {
      return db.transaction(() => {
        const existingOpen = db.prepare(`
          SELECT id, shift_date, opened_at
          FROM shifts
          WHERE status = 'OPEN'
          ORDER BY opened_at DESC
          LIMIT 1
        `).get() as any;
        if (existingOpen) {
          return {
            success: false,
            error: `A shift from ${existingOpen.shift_date} is still open. Close that shift first, then open today's shift.`
          };
        }

        const now = new Date().toISOString();
        const nowDate = new Date();
        const date = formatLocalDate(nowDate);

        // Soft warn before the configured shop-day start (e.g. before 5 AM) ONLY
        // if the user might be confused: we already verified there is NO open
        // shift above, so the only ambiguous case left is when the most recent
        // CLOSED shift is from today's calendar date — meaning the user is
        // opening a *second* shift in the same calendar day before sunrise.
        // In every other case (including the normal "next day, fresh open"
        // flow the cashier hits in the morning) just open the shift.
        if (shouldWarnBeforeOpeningShift(nowDate) && !data?.confirmAfterMidnightOpen) {
          const lastClosed = db.prepare(`
            SELECT shift_date
            FROM shifts
            WHERE status = 'CLOSED'
            ORDER BY closed_at DESC
            LIMIT 1
          `).get() as any;
          if (lastClosed && lastClosed.shift_date === date) {
            return {
              success: false,
              requiresPreviousShiftConfirmation: true,
              error: "It is before the shop's day-start hour and a shift was already closed for today. Open a new one anyway?"
            };
          }
        }
        const user = getCurrentUser();
        const openedById = user?.id || 'system';
        const openingCash = Number(data?.openingCash || 0);
        if (!Number.isFinite(openingCash) || openingCash < 0) {
          return { success: false, error: 'Opening cash must be zero or more' };
        }
        const shiftId = crypto.randomUUID();

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

        // Find any *open* register for today. We deliberately ignore closed
        // registers from earlier in the day (or from yesterday with the same
        // calendar date if the clock skewed) — they are historical records
        // and must not block opening a new shift.
        const existingRegister = db.prepare('SELECT * FROM cash_register WHERE date = ? AND is_closed_for_day = 0 ORDER BY created_at DESC LIMIT 1').get(date) as any;
        if (!existingRegister) {
          const registerId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO cash_register (id, shift_id, date, opening_balance, cash_in, cash_out, closing_balance, is_closed_for_day, created_at, synced)
            VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, 0)
          `).run(registerId, shiftId, date, openingCash, openingCash, now);

          createOutboxEntry('cash_register', 'INSERT', registerId, {
            id: registerId,
            shift_id: shiftId,
            date,
            opening_balance: openingCash,
            cash_in: 0,
            cash_out: 0,
            closing_balance: openingCash,
            is_closed_for_day: 0,
            created_at: now
          });
        } else if (!existingRegister.shift_id) {
          // Register was opened with no shift attached (e.g. cashRegister:open
          // ran before shifts:open) — link it to the new shift now.
          db.prepare('UPDATE cash_register SET shift_id = ?, synced = 0 WHERE id = ?').run(shiftId, existingRegister.id);
          createOutboxEntry('cash_register', 'UPDATE', existingRegister.id, {
            id: existingRegister.id,
            shift_id: shiftId,
            date,
            updated_at: now
          });
        } else {
          // Register exists, is open, and is already linked to some other
          // shift_id. The earlier `existingOpen` check guarantees that other
          // shift is NOT open, so this is an orphaned register. Take it over
          // for the new shift so the new shift has a register to write into.
          db.prepare('UPDATE cash_register SET shift_id = ?, synced = 0 WHERE id = ?').run(shiftId, existingRegister.id);
          createOutboxEntry('cash_register', 'UPDATE', existingRegister.id, {
            id: existingRegister.id,
            shift_id: shiftId,
            date,
            updated_at: now
          });
        }

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

        const now = new Date().toISOString();
        const closedById = getCurrentUser()?.id || 'system';
        const expectedCash = getCashRegisterExpected(shift.shift_date, shift.id).expectedCash;
        const closingCash = Number(data?.closingCash || 0);
        if (!Number.isFinite(closingCash) || closingCash < 0) {
          return { success: false, error: 'Closing cash must be zero or more' };
        }
        const variance = Number((closingCash - expectedCash).toFixed(2));
        const register = db.prepare('SELECT * FROM cash_register WHERE shift_id = ? OR (shift_id IS NULL AND date = ?) ORDER BY created_at DESC LIMIT 1').get(shift.id, shift.shift_date) as any;
        if (!register) {
          return { success: false, error: 'Cash register was not opened for this shift date' };
        }
        if (Number(register.is_closed_for_day || 0) === 1) {
          return { success: false, error: 'Cash register is already closed for this date' };
        }

        db.prepare(`
          UPDATE shifts
          SET closed_by_id = ?, closed_at = ?, expected_cash = ?, closing_cash = ?,
              cash_variance = ?, receipt_audit_session_id = NULL, status = 'CLOSED',
              notes = ?, synced = 0
          WHERE id = ?
        `).run(
          closedById,
          now,
          expectedCash,
          closingCash,
          variance,
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
          receipt_audit_session_id: null,
          status: 'CLOSED',
          notes: data?.notes || shift.notes || null
        });

        createOutboxEntry('cash_register', 'UPDATE', register.id, {
          id: register.id,
          shift_id: shift.id,
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
