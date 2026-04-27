import db from './db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { getActiveBusinessDate, getOpenShift } from './businessDay';

export function getTodayDate() {
  return getActiveBusinessDate();
}

function getRegister(date: string, shiftId?: string | null) {
  if (shiftId) {
    const byShift = db.prepare('SELECT * FROM cash_register WHERE shift_id = ?').get(shiftId) as any;
    if (byShift) return byShift;
  }
  return db.prepare('SELECT * FROM cash_register WHERE date = ? ORDER BY created_at DESC LIMIT 1').get(date) as any;
}

export function getCashRegisterExpected(date = getTodayDate(), shiftId?: string | null) {
  const register = getRegister(date, shiftId);
  const openingCash = Number(register?.opening_balance || 0);
  const cashIn = Number(register?.cash_in || 0);
  const cashOut = Number(register?.cash_out || 0);
  const expectedCash = Number((openingCash + cashIn - cashOut).toFixed(2));

  return {
    register,
    openingCash,
    cashIn,
    cashOut,
    expectedCash
  };
}

export function ensureOpenCashRegister(date = getTodayDate(), shiftId?: string | null) {
  const activeShift = shiftId ? null : getOpenShift();
  const resolvedShiftId = shiftId || activeShift?.id || null;
  const existing = getRegister(date, resolvedShiftId);
  if (existing) {
    if (Number(existing.is_closed_for_day) === 1) {
      throw new Error('Cash register is already closed for today');
    }
    return existing;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO cash_register (id, shift_id, date, opening_balance, cash_in, cash_out, closing_balance, is_closed_for_day, created_at, synced)
    VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, 0)
  `).run(id, resolvedShiftId, date, now);

  createOutboxEntry('cash_register', 'INSERT', id, {
    id,
    shift_id: resolvedShiftId,
    date,
    opening_balance: 0,
    cash_in: 0,
    cash_out: 0,
    closing_balance: 0,
    is_closed_for_day: 0,
    created_at: now
  });

  return db.prepare('SELECT * FROM cash_register WHERE id = ?').get(id) as any;
}

export function addCashIn(amount: number, date = getTodayDate(), shiftId?: string | null) {
  if (amount <= 0) return;
  const register = ensureOpenCashRegister(date, shiftId);
  const nextCashIn = Number(register.cash_in || 0) + amount;
  db.prepare('UPDATE cash_register SET cash_in = ?, synced = 0 WHERE id = ?').run(nextCashIn, register.id);
  createOutboxEntry('cash_register', 'UPDATE', register.id, {
    id: register.id,
    shift_id: register.shift_id || shiftId || null,
    cash_in: nextCashIn,
    date
  });
}

export function addCashOut(amount: number, date = getTodayDate(), shiftId?: string | null) {
  if (amount <= 0) return;
  adjustCashOut(amount, date, shiftId);
}

export function adjustCashOut(delta: number, date = getTodayDate(), shiftId?: string | null) {
  if (delta === 0) return;
  const register = ensureOpenCashRegister(date, shiftId);
  const nextCashOut = Math.max(0, Number(register.cash_out || 0) + delta);
  db.prepare('UPDATE cash_register SET cash_out = ?, synced = 0 WHERE id = ?').run(nextCashOut, register.id);
  createOutboxEntry('cash_register', 'UPDATE', register.id, {
    id: register.id,
    shift_id: register.shift_id || shiftId || null,
    cash_out: nextCashOut,
    date
  });
}
