"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCustomersIPC = registerCustomersIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const cashRegister_1 = require("../database/cashRegister");
const auth_ipc_1 = require("./auth.ipc");
function registerCustomersIPC() {
    electron_1.ipcMain.handle('customers:getAll', (_event, filters) => {
        const search = filters?.search?.trim();
        if (!search) {
            return db_1.default.prepare('SELECT * FROM customers WHERE is_active = 1 ORDER BY name ASC').all();
        }
        const like = `%${search}%`;
        return db_1.default.prepare(`
      SELECT * FROM customers
      WHERE is_active = 1
        AND (name LIKE ? OR phone LIKE ? OR card_number LIKE ?)
      ORDER BY name ASC
    `).all(like, like, like);
    });
    // Fast POS lookup — search by card number, name, or phone
    electron_1.ipcMain.handle('customers:search', (_event, query) => {
        if (!query?.trim())
            return [];
        const like = `%${query.trim()}%`;
        return db_1.default.prepare(`
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
    electron_1.ipcMain.handle('customers:getStatement', (_event, id, startDate, endDate) => {
        const customer = db_1.default.prepare('SELECT * FROM customers WHERE id = ?').get(id);
        if (!customer)
            return null;
        let ledger;
        let openingBalance = 0;
        if (startDate && endDate) {
            // Calculate opening balance (balance after the last entry before startDate)
            const lastEntryBefore = db_1.default.prepare(`
        SELECT balance_after FROM ledger_entries 
        WHERE customer_id = ? AND entry_date < ? 
        ORDER BY entry_date DESC LIMIT 1
      `).get(id, startDate);
            openingBalance = lastEntryBefore ? lastEntryBefore.balance_after : 0;
            ledger = db_1.default.prepare(`
        SELECT * FROM ledger_entries 
        WHERE customer_id = ? 
          AND entry_date >= ? 
          AND entry_date <= ? 
        ORDER BY entry_date ASC
      `).all(id, startDate, endDate + 'T23:59:59');
        }
        else {
            // Default: last 30 days or all? Let's say all if no dates provided
            ledger = db_1.default.prepare(`
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
    electron_1.ipcMain.handle('customers:getOne', (_event, id) => {
        return db_1.default.prepare('SELECT * FROM customers WHERE id = ?').get(id) || null;
    });
    electron_1.ipcMain.handle('customers:create', async (_event, data) => {
        try {
            const now = new Date().toISOString();
            const id = crypto.randomUUID();
            const code = data.code || `CUST-${Date.now()}`;
            const openingBalance = Number(data.openingBalance || 0);
            db_1.default.transaction(() => {
                db_1.default.prepare(`
          INSERT INTO customers (
            id, code, card_number, name, phone, address, credit_limit, current_balance,
            is_active, created_at, updated_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)
        `).run(id, code, data.cardNumber || null, data.name, data.phone || null, data.address || null, Number(data.creditLimit || 0), openingBalance, now, now);
                (0, outboxHelper_1.createOutboxEntry)('customers', 'INSERT', id, {
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
                    db_1.default.prepare(`
            INSERT INTO ledger_entries (
              id, customer_id, entry_type, amount, balance_after, description, entry_date, created_at, synced
            ) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, ?, ?, 0)
          `).run(ledgerId, id, openingBalance, openingBalance, 'Opening balance', now, now);
                    (0, outboxHelper_1.createOutboxEntry)('ledger_entries', 'INSERT', ledgerId, {
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
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('customers:update', async (_event, id, data) => {
        try {
            const oldCustomer = db_1.default.prepare('SELECT * FROM customers WHERE id = ?').get(id);
            if (!oldCustomer)
                return { success: false, error: 'Customer not found' };
            const now = new Date().toISOString();
            db_1.default.prepare(`
        UPDATE customers
        SET name = ?, phone = ?, address = ?, card_number = ?, credit_limit = ?, updated_at = ?, synced = 0
        WHERE id = ?
      `).run(data.name ?? oldCustomer.name, data.phone ?? oldCustomer.phone, data.address ?? oldCustomer.address, data.cardNumber ?? oldCustomer.card_number, Number(data.creditLimit ?? oldCustomer.credit_limit), now, id);
            (0, outboxHelper_1.createOutboxEntry)('customers', 'UPDATE', id, {
                id,
                name: data.name ?? oldCustomer.name,
                phone: data.phone ?? oldCustomer.phone,
                address: data.address ?? oldCustomer.address,
                card_number: data.cardNumber ?? oldCustomer.card_number,
                credit_limit: Number(data.creditLimit ?? oldCustomer.credit_limit),
                updated_at: now
            });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('customers:remove', async (_event, id) => {
        try {
            const now = new Date().toISOString();
            db_1.default.prepare('UPDATE customers SET is_active = 0, updated_at = ?, synced = 0 WHERE id = ?').run(now, id);
            (0, outboxHelper_1.createOutboxEntry)('customers', 'UPDATE', id, { id, is_active: 0, updated_at: now });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('customers:getLedger', (_event, id) => {
        return db_1.default.prepare('SELECT * FROM ledger_entries WHERE customer_id = ? ORDER BY entry_date DESC').all(id);
    });
    electron_1.ipcMain.handle('customers:collectPayment', async (_event, id, data) => {
        const transaction = db_1.default.transaction(() => {
            const now = new Date().toISOString();
            const customer = db_1.default.prepare('SELECT current_balance FROM customers WHERE id = ?').get(id);
            if (!customer)
                throw new Error('Customer not found');
            const balanceBefore = customer.current_balance || 0;
            const amount = Number(data.amount || 0);
            const collectedById = data.userId || data.cashierId || (0, auth_ipc_1.getCurrentUser)()?.id || 'system';
            if (amount <= 0)
                throw new Error('Payment amount must be greater than zero');
            if (amount > balanceBefore)
                throw new Error('Payment cannot be greater than customer balance');
            // In this system, current_balance tracks they owe us. Collecting payment reduces it.
            const balanceAfter = balanceBefore - amount;
            // 1. UPDATE customers
            db_1.default.prepare('UPDATE customers SET current_balance = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, id);
            (0, outboxHelper_1.createOutboxEntry)('customers', 'UPDATE', id, { id, current_balance: balanceAfter, updated_at: now });
            // 2. INSERT payments
            const paymentId = crypto.randomUUID();
            db_1.default.prepare(`
        INSERT INTO payments (id, customer_id, amount, payment_date, collected_by_id, notes, created_at, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(paymentId, id, amount, now, collectedById, data.notes || '', now);
            (0, outboxHelper_1.createOutboxEntry)('payments', 'INSERT', paymentId, {
                id: paymentId,
                customer_id: id,
                amount,
                payment_date: now,
                collected_by_id: collectedById,
                notes: data.notes || '',
                created_at: now
            });
            // 3. INSERT ledger_entries
            const ledgerId = crypto.randomUUID();
            db_1.default.prepare(`
        INSERT INTO ledger_entries (id, customer_id, payment_id, entry_type, amount, balance_after, description, entry_date, created_at, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(ledgerId, id, paymentId, 'PAYMENT_RECEIVED', amount, balanceAfter, 'Payment Received', now, now);
            (0, outboxHelper_1.createOutboxEntry)('ledger_entries', 'INSERT', ledgerId, {
                id: ledgerId,
                customer_id: id,
                payment_id: paymentId,
                entry_type: 'PAYMENT_RECEIVED',
                amount,
                balance_after: balanceAfter,
                description: 'Payment Received',
                entry_date: now,
                created_at: now
            });
            // 4. UPDATE cash_register
            (0, cashRegister_1.addCashIn)(amount);
            return { success: true };
        });
        try {
            return transaction();
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
}
