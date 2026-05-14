import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { addCashIn, addCashOut, adjustCashOut } from '../database/cashRegister';
import { getCurrentUser, requireCurrentUser, requireManagerApproval } from './auth.ipc';
import { logAudit } from '../audit/auditLog';
import { getActiveBusinessDate, getOpenShift } from '../database/businessDay';

function normalizeDateOnly(value: unknown) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  return null;
}

function getMonthRangeFromDate(date: string) {
  const [year, month] = date.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  return { start, end };
}

function getAverageCost(productCode: 'MILK' | 'YOGT', date: string, fallbackCost: number) {
  if (productCode === 'MILK') {
    const { start, end } = getMonthRangeFromDate(date);
    const row = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total_amount, COALESCE(SUM(quantity), 0) as quantity
      FROM milk_collections
      WHERE collection_date >= ? AND collection_date <= ?
    `).get(start, end) as any;
    const quantity = Number(row?.quantity || 0);
    const amount = Number(row?.total_amount || 0);
    if (quantity > 0 && amount > 0) return Number((amount / quantity).toFixed(2));
  }
  return Number(fallbackCost || 0);
}

export function registerExpensesIPC() {
  ipcMain.handle('expenses:getAll', (_event, filters?: any) => {
    const date = String(filters?.date || '').trim();
    const startDate = normalizeDateOnly(filters?.startDate);
    const endDate = normalizeDateOnly(filters?.endDate);
    if (startDate && endDate) {
      return db.prepare(`
        SELECT *
        FROM expenses
        WHERE substr(expense_date, 1, 10) >= ?
        AND substr(expense_date, 1, 10) <= ?
        ORDER BY expense_date DESC
      `).all(startDate, endDate);
    }
    if (date) {
      return db.prepare('SELECT * FROM expenses WHERE substr(expense_date, 1, ?) = ? ORDER BY expense_date DESC').all(date.length, date);
    }
    return db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC').all();
  });

  ipcMain.handle('expenses:create', async (_event, data: any) => {
    const transaction = db.transaction(() => {
      requireCurrentUser();
      const now = new Date().toISOString();
      const code = `EXP-${Date.now()}`;
      const expenseId = crypto.randomUUID();
      const expenseDate = normalizeDateOnly(data.date) || getActiveBusinessDate(new Date(now));
      const amount = Number(data.amount || 0);
      const createdById = data.userId || getCurrentUser()?.id || 'system';
      const shift = getOpenShift();
      if (amount <= 0) throw new Error('Expense amount must be greater than zero');
      if (!data.category) throw new Error('Expense category is required');
      if (!data.description?.trim()) throw new Error('Expense description is required');

      // INSERT expense
      db.prepare(`
        INSERT INTO expenses (id, code, shift_id, expense_date, category, description, amount, created_by_id, created_at, updated_at, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(expenseId, code, shift?.id || null, expenseDate, data.category, data.description, amount, createdById, now, now);
      createOutboxEntry('expenses', 'INSERT', expenseId, {
        id: expenseId,
        code,
        shift_id: shift?.id || null,
        expense_date: expenseDate,
        category: data.category,
        description: data.description,
        amount,
        created_by_id: createdById,
        created_at: now,
        updated_at: now
      });

      // UPDATE cash_register
      addCashOut(amount, shift?.shift_date || getActiveBusinessDate(new Date(now)), shift?.id || null);

      return { success: true };
    });

    try {
      return transaction();
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('expenses:getWastageDefaults', () => {
    try {
      requireCurrentUser();
      const today = getActiveBusinessDate();
      const rows = db.prepare(`
        SELECT id, code, name, unit, stock, cost_price
        FROM products
        WHERE code IN ('MILK', 'YOGT') AND is_active = 1
        ORDER BY CASE code WHEN 'MILK' THEN 1 ELSE 2 END
      `).all() as any[];
      return rows.map((row) => ({
        ...row,
        averageCost: getAverageCost(String(row.code).toUpperCase() === 'MILK' ? 'MILK' : 'YOGT', today, Number(row.cost_price || 0))
      }));
    } catch (e: any) {
      return [];
    }
  });

  ipcMain.handle('expenses:addWastage', async (_event, data: any) => {
    try {
      const actor = requireCurrentUser(['ADMIN', 'MANAGER']);
      const expenseDate = normalizeDateOnly(data.date) || getActiveBusinessDate();
      const productCode = String(data.productCode || '').trim().toUpperCase();
      if (!['MILK', 'YOGT'].includes(productCode)) {
        return { success: false, error: 'Select milk or yogurt wastage' };
      }

      const quantity = Number(data.quantity || 0);
      const sellAmount = Math.max(0, Number(data.sellAmount || 0));
      if (!Number.isFinite(quantity) || quantity <= 0) return { success: false, error: 'Wastage quantity must be greater than zero' };
      if (!Number.isFinite(sellAmount)) return { success: false, error: 'Sell amount is invalid' };

      const product = db.prepare(`
        SELECT id, code, name, stock, cost_price
        FROM products
        WHERE code = ? AND is_active = 1
        LIMIT 1
      `).get(productCode) as any;
      if (!product) return { success: false, error: `${productCode} product not found` };
      const stockBefore = Number(product.stock || 0);
      if (stockBefore < quantity) {
        return { success: false, error: `Not enough ${product.name} stock. Available ${stockBefore.toFixed(2)} kg.` };
      }

      const averageCost = getAverageCost(productCode as 'MILK' | 'YOGT', expenseDate, Number(product.cost_price || 0));
      if (averageCost <= 0) return { success: false, error: `${product.name} average purchase cost is missing` };

      const grossLoss = Number((quantity * averageCost).toFixed(2));
      const netLoss = Number(Math.max(0, grossLoss - sellAmount).toFixed(2));
      const now = new Date().toISOString();
      const shift = getOpenShift();
      const userId = actor?.id || getCurrentUser()?.id || 'system';
      const expenseId = crypto.randomUUID();
      const movementId = crypto.randomUUID();
      const wastageCode = `WST-${Date.now()}`;
      const stockAfter = Number((stockBefore - quantity).toFixed(3));
      const extraNotes = String(data.notes || '').trim();
      const description = `${product.name} wastage ${quantity} kg @ avg Rs.${averageCost}; gross ${grossLoss}; recovery ${sellAmount}; net ${netLoss}${extraNotes ? `; ${extraNotes}` : ''}`;

      db.transaction(() => {
        db.prepare(`
          UPDATE products
          SET stock = ?, updated_at = ?, synced = 0
          WHERE id = ?
        `).run(stockAfter, now, product.id);
        createOutboxEntry('products', 'UPDATE', product.id, {
          id: product.id,
          stock: stockAfter,
          updated_at: now
        });

        db.prepare(`
          INSERT INTO stock_movements (id, product_id, movement_type, quantity, stock_before, stock_after, supplier, notes, reference_id, created_by_id, created_at, synced)
          VALUES (?, ?, 'WASTAGE', ?, ?, ?, NULL, ?, ?, ?, ?, 0)
        `).run(movementId, product.id, quantity, stockBefore, stockAfter, description, expenseId, userId, now);
        createOutboxEntry('stock_movements', 'INSERT', movementId, {
          id: movementId,
          product_id: product.id,
          movement_type: 'WASTAGE',
          quantity,
          stock_before: stockBefore,
          stock_after: stockAfter,
          supplier: null,
          notes: description,
          reference_id: expenseId,
          created_by_id: userId,
          created_at: now
        });

        db.prepare(`
          INSERT INTO expenses (id, code, shift_id, expense_date, category, description, amount, created_by_id, created_at, updated_at, synced)
          VALUES (?, ?, ?, ?, 'WASTAGE', ?, ?, ?, ?, ?, 0)
        `).run(expenseId, wastageCode, shift?.id || null, expenseDate, description, netLoss, userId, now, now);
        createOutboxEntry('expenses', 'INSERT', expenseId, {
          id: expenseId,
          code: wastageCode,
          shift_id: shift?.id || null,
          expense_date: expenseDate,
          category: 'WASTAGE',
          description,
          amount: netLoss,
          created_by_id: userId,
          created_at: now,
          updated_at: now
        });

        if (sellAmount > 0) {
          addCashIn(sellAmount, shift?.shift_date || expenseDate, shift?.id || null);
        }
      })();

      return { success: true, expenseId, movementId, grossLoss, sellAmount, netLoss, averageCost, stockAfter };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('expenses:update', async (_event, id: string, data: any) => {
    try {
      const actor = requireCurrentUser(['ADMIN', 'MANAGER']);
      const oldExpense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as any;
      if (!oldExpense) return { success: false, error: 'Expense not found' };
      const now = new Date().toISOString();
      const oldAmount = Number(oldExpense.amount || 0);
      const nextAmount = Number(data.amount ?? oldExpense.amount);
      const nextDate = normalizeDateOnly(data.date) || normalizeDateOnly(oldExpense.expense_date) || getActiveBusinessDate(new Date(now));
      const nextCategory = data.category ?? oldExpense.category;
      if (nextCategory !== oldExpense.category && actor.role !== 'ADMIN') {
        return { success: false, error: 'Only administrator can change an old expense category' };
      }
      if (nextAmount <= 0) return { success: false, error: 'Expense amount must be greater than zero' };
      db.prepare(`
        UPDATE expenses
        SET expense_date = ?, category = ?, description = ?, amount = ?, updated_at = ?, synced = 0
        WHERE id = ?
      `).run(
        nextDate,
        nextCategory,
        data.description ?? oldExpense.description,
        nextAmount,
        now,
        id
      );
      createOutboxEntry('expenses', 'UPDATE', id, {
        id,
        expense_date: nextDate,
        category: nextCategory,
        description: data.description ?? oldExpense.description,
        amount: nextAmount,
        updated_at: now
      });
      const difference = nextAmount - oldAmount;
      adjustCashOut(difference, oldExpense.shift_id ? undefined : String(oldExpense.expense_date).split('T')[0], oldExpense.shift_id || null);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('expenses:remove', async (_event, id: string, options?: { managerPin?: string; reason?: string }) => {
    try {
      const actor = requireCurrentUser();
      const oldExpense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as any;
      if (!oldExpense) return { success: false, error: 'Expense not found' };
      const approver = requireManagerApproval(options?.managerPin, 'deleting an expense');
      const reason = String(options?.reason || '').trim();
      if (reason.length < 5) {
        return { success: false, error: 'Provide a reason (min 5 characters) to delete this expense' };
      }
      db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
      createOutboxEntry('expenses', 'DELETE', id, { id });
      adjustCashOut(-Number(oldExpense.amount || 0), oldExpense.shift_id ? undefined : String(oldExpense.expense_date).split('T')[0], oldExpense.shift_id || null);
      logAudit({
        actionType: 'EXPENSE_DELETED',
        entityType: 'expenses',
        entityId: id,
        before: oldExpense,
        reason,
        actor,
        approvedBy: approver
      });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('expenses:getSummary', () => {
    const row = db.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total
      FROM expenses
    `).get() as any;
    return {
      count: Number(row?.count || 0),
      total: Number(row?.total || 0)
    };
  });
}
