import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { addCashOut, adjustCashOut } from '../database/cashRegister';
import { getCurrentUser } from './auth.ipc';

export function registerExpensesIPC() {
  ipcMain.handle('expenses:getAll', (_event, filters?: any) => {
    const date = filters?.date?.trim();
    if (date) {
      return db.prepare('SELECT * FROM expenses WHERE expense_date LIKE ? ORDER BY expense_date DESC').all(`${date}%`);
    }
    return db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC').all();
  });

  ipcMain.handle('expenses:create', async (_event, data: any) => {
    const transaction = db.transaction(() => {
      const now = new Date().toISOString();
      const code = `EXP-${Date.now()}`;
      const expenseId = crypto.randomUUID();
      const expenseDate = data.date ? `${data.date}T00:00:00.000Z` : now;
      const amount = Number(data.amount || 0);
      const createdById = data.userId || getCurrentUser()?.id || 'system';
      if (amount <= 0) throw new Error('Expense amount must be greater than zero');

      // INSERT expense
      db.prepare(`
        INSERT INTO expenses (id, code, expense_date, category, description, amount, created_by_id, created_at, updated_at, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(expenseId, code, expenseDate, data.category, data.description, amount, createdById, now, now);
      createOutboxEntry('expenses', 'INSERT', expenseId, {
        id: expenseId, code, expense_date: expenseDate, category: data.category, amount, created_at: now
      });

      // UPDATE cash_register
      addCashOut(amount, expenseDate.split('T')[0]);

      return { success: true };
    });

    try {
      return transaction();
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('expenses:update', async (_event, id: string, data: any) => {
    try {
      const oldExpense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as any;
      if (!oldExpense) return { success: false, error: 'Expense not found' };
      const now = new Date().toISOString();
      const oldAmount = Number(oldExpense.amount || 0);
      const nextAmount = Number(data.amount ?? oldExpense.amount);
      if (nextAmount <= 0) return { success: false, error: 'Expense amount must be greater than zero' };
      db.prepare(`
        UPDATE expenses
        SET category = ?, description = ?, amount = ?, updated_at = ?, synced = 0
        WHERE id = ?
      `).run(
        data.category ?? oldExpense.category,
        data.description ?? oldExpense.description,
        nextAmount,
        now,
        id
      );
      createOutboxEntry('expenses', 'UPDATE', id, {
        id,
        category: data.category ?? oldExpense.category,
        description: data.description ?? oldExpense.description,
        amount: nextAmount,
        updated_at: now
      });
      const difference = nextAmount - oldAmount;
      adjustCashOut(difference, String(oldExpense.expense_date).split('T')[0]);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('expenses:remove', async (_event, id: string) => {
    try {
      const oldExpense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as any;
      if (!oldExpense) return { success: false, error: 'Expense not found' };
      db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
      createOutboxEntry('expenses', 'DELETE', id, { id });
      adjustCashOut(-Number(oldExpense.amount || 0), String(oldExpense.expense_date).split('T')[0]);
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
