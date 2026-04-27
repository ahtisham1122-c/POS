import db from './db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { getBusinessDate } from './businessDay';

export function getTodayDate() {
  return getBusinessDate();
}

export function getCashRegisterExpected(date = getTodayDate()) {
  const register = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(date) as any;
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

export function ensureOpenCashRegister(date = getTodayDate()) {
  const existing = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(date) as any;
  if (existing) {
    if (Number(existing.is_closed_for_day) === 1) {
      throw new Error('Cash register is already closed for today');
    }
    return existing;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO cash_register (id, date, opening_balance, cash_in, cash_out, closing_balance, is_closed_for_day, created_at, synced)
    VALUES (?, ?, 0, 0, 0, 0, 0, ?, 0)
  `).run(id, date, now);

  createOutboxEntry('cash_register', 'INSERT', id, {
    id,
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

export function addCashIn(amount: number, date = getTodayDate()) {
  if (amount <= 0) return;
  const register = ensureOpenCashRegister(date);
  const nextCashIn = Number(register.cash_in || 0) + amount;
  db.prepare('UPDATE cash_register SET cash_in = ?, synced = 0 WHERE id = ?').run(nextCashIn, register.id);
  createOutboxEntry('cash_register', 'UPDATE', register.id, {
    id: register.id,
    cash_in: nextCashIn,
    date
  });
}

export function addCashOut(amount: number, date = getTodayDate()) {
  if (amount <= 0) return;
  adjustCashOut(amount, date);
}

export function adjustCashOut(delta: number, date = getTodayDate()) {
  if (delta === 0) return;
  const register = ensureOpenCashRegister(date);
  const nextCashOut = Math.max(0, Number(register.cash_out || 0) + delta);
  db.prepare('UPDATE cash_register SET cash_out = ?, synced = 0 WHERE id = ?').run(nextCashOut, register.id);
  createOutboxEntry('cash_register', 'UPDATE', register.id, {
    id: register.id,
    cash_out: nextCashOut,
    date
  });
}
