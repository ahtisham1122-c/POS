import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { addCashIn } from '../database/cashRegister';
import { getCurrentUser } from './auth.ipc';

export function registerCustomersIPC() {
  ipcMain.handle('customers:getAll', (_event, filters) => {
    const search = filters?.search?.trim();
    if (!search) {
      return db.prepare('SELECT * FROM customers WHERE is_active = 1 ORDER BY name ASC').all();
    }
    const like = `%${search}%`;
    return db.prepare(`
      SELECT * FROM customers
      WHERE is_active = 1
        AND (name LIKE ? OR phone LIKE ? OR card_number LIKE ?)
      ORDER BY name ASC
    `).all(like, like, like);
  });

  // Fast POS lookup — search by card number, name, or phone
  ipcMain.handle('customers:search', (_event, query: string) => {
    if (!query?.trim()) return [];
    const like = `%${query.trim()}%`;
    return db.prepare(`
      SELECT id, name, card_number, phone, current_balance, credit_limit
      FROM customers
      WHERE is_active = 1
        AND (card_number LIKE ? OR name LIKE ? OR phone LIKE ?)
      ORDER BY 
        CASE WHEN card_number LIKE ? THEN 0 ELSE 1 END,
        name ASC
      LIMIT 10
    `).all(like, like, like, like);
  });

  // Full statement for printing: customer info + date-ranged ledger entries + opening balance
  ipcMain.handle('customers:getStatement', (_event, id: string, startDate?: string, endDate?: string) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!customer) return null;

    let ledger;
    let openingBalance = 0;

    if (startDate && endDate) {
      // Calculate opening balance (balance after the last entry before startDate)
      const lastEntryBefore = db.prepare(`
        SELECT balance_after FROM ledger_entries 
        WHERE customer_id = ? AND entry_date < ? 
        ORDER BY entry_date DESC LIMIT 1
      `).get(id, startDate) as any;
      
      openingBalance = lastEntryBefore ? lastEntryBefore.balance_after : 0;

      ledger = db.prepare(`
        SELECT * FROM ledger_entries 
        WHERE customer_id = ? 
          AND entry_date >= ? 
          AND entry_date <= ? 
        ORDER BY entry_date ASC
      `).all(id, startDate, endDate + 'T23:59:59');
    } else {
      // Default: last 30 days or all? Let's say all if no dates provided
      ledger = db.prepare(`
        SELECT * FROM ledger_entries 
        WHERE customer_id = ? 
        ORDER BY entry_date ASC
      `).all(id);
      
      // For all history, opening balance is effectively the first entry's balance_after - amount (if it was the first)
      // or just 0 if we assume history starts from 0.
      openingBalance = 0; 
    }

    return { customer, ledger, openingBalance };
  });

  ipcMain.handle('customers:getOne', (_event, id: string) => {
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(id) || null;
  });

  ipcMain.handle('customers:create', async (_event, data: any) => {
    try {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const code = data.code || `CUST-${Date.now()}`;
      const openingBalance = Number(data.openingBalance || 0);

      db.transaction(() => {
        db.prepare(`
          INSERT INTO customers (
            id, code, card_number, name, phone, address, credit_limit, current_balance,
            is_active, created_at, updated_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)
        `).run(
          id,
          code,
          data.cardNumber || null,
          data.name,
          data.phone || null,
          data.address || null,
          Number(data.creditLimit || 0),
          openingBalance,
          now,
          now
        );

        createOutboxEntry('customers', 'INSERT', id, {
          id,
          code,
          card_number: data.cardNumber || null,
          name: data.name,
          phone: data.phone || null,
          address: data.address || null,
          credit_limit: Number(data.creditLimit || 0),
          current_balance: openingBalance,
          created_at: now,
          updated_at: now
        });

        if (openingBalance !== 0) {
          const ledgerId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO ledger_entries (
              id, customer_id, entry_type, amount, balance_after, description, entry_date, created_at, synced
            ) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, ?, ?, 0)
          `).run(ledgerId, id, openingBalance, openingBalance, 'Opening balance', now, now);
          createOutboxEntry('ledger_entries', 'INSERT', ledgerId, {
            id: ledgerId,
            customer_id: id,
            entry_type: 'ADJUSTMENT',
            amount: openingBalance,
            balance_after: openingBalance,
            description: 'Opening balance',
            created_at: now
          });
        }
      })();

      return { success: true, id };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('customers:update', async (_event, id: string, data: any) => {
    try {
      const oldCustomer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
      if (!oldCustomer) return { success: false, error: 'Customer not found' };

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE customers
        SET name = ?, phone = ?, address = ?, card_number = ?, credit_limit = ?, updated_at = ?, synced = 0
        WHERE id = ?
      `).run(
        data.name ?? oldCustomer.name,
        data.phone ?? oldCustomer.phone,
        data.address ?? oldCustomer.address,
        data.cardNumber ?? oldCustomer.card_number,
        Number(data.creditLimit ?? oldCustomer.credit_limit),
        now,
        id
      );

      createOutboxEntry('customers', 'UPDATE', id, {
        id,
        name: data.name ?? oldCustomer.name,
        phone: data.phone ?? oldCustomer.phone,
        address: data.address ?? oldCustomer.address,
        card_number: data.cardNumber ?? oldCustomer.card_number,
        credit_limit: Number(data.creditLimit ?? oldCustomer.credit_limit),
        updated_at: now
      });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('customers:remove', async (_event, id: string) => {
    try {
      const now = new Date().toISOString();
      db.prepare('UPDATE customers SET is_active = 0, updated_at = ?, synced = 0 WHERE id = ?').run(now, id);
      createOutboxEntry('customers', 'UPDATE', id, { id, is_active: 0, updated_at: now });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('customers:getLedger', (_event, id: string) => {
    return db.prepare('SELECT * FROM ledger_entries WHERE customer_id = ? ORDER BY entry_date DESC').all(id);
  });

  ipcMain.handle('customers:collectPayment', async (_event, id: string, data: any) => {
    const transaction = db.transaction(() => {
      const now = new Date().toISOString();
      const customer = db.prepare('SELECT current_balance FROM customers WHERE id = ?').get(id) as any;
      if (!customer) throw new Error('Customer not found');

      const balanceBefore = customer.current_balance || 0;
      const amount = Number(data.amount || 0);
      const collectedById = data.userId || data.cashierId || getCurrentUser()?.id || 'system';
      if (amount <= 0) throw new Error('Payment amount must be greater than zero');
      if (amount > balanceBefore) throw new Error('Payment cannot be greater than customer balance');
      // In this system, current_balance tracks they owe us. Collecting payment reduces it.
      const balanceAfter = balanceBefore - amount;

      // 1. UPDATE customers
      db.prepare('UPDATE customers SET current_balance = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, id);
      createOutboxEntry('customers', 'UPDATE', id, { id, current_balance: balanceAfter, updated_at: now });

      // 2. INSERT payments
      const paymentId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO payments (id, customer_id, amount, payment_date, collected_by_id, notes, created_at, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(paymentId, id, amount, now, collectedById, data.notes || '', now);
      createOutboxEntry('payments', 'INSERT', paymentId, { id: paymentId, customer_id: id, amount, created_at: now });

      // 3. INSERT ledger_entries
      const ledgerId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO ledger_entries (id, customer_id, payment_id, entry_type, amount, balance_after, description, entry_date, created_at, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(ledgerId, id, paymentId, 'PAYMENT_RECEIVED', amount, balanceAfter, 'Payment Received', now, now);
      createOutboxEntry('ledger_entries', 'INSERT', ledgerId, { id: ledgerId, customer_id: id, entry_type: 'PAYMENT_RECEIVED', amount, created_at: now });

      // 4. UPDATE cash_register
      addCashIn(amount);

      return { success: true };
    });

    try {
      return transaction();
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
