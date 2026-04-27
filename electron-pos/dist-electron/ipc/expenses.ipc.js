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
exports.registerExpensesIPC = registerExpensesIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const cashRegister_1 = require("../database/cashRegister");
const auth_ipc_1 = require("./auth.ipc");
const businessDay_1 = require("../database/businessDay");
function registerExpensesIPC() {
    electron_1.ipcMain.handle('expenses:getAll', (_event, filters) => {
        const date = filters?.date?.trim();
        if (date) {
            return db_1.default.prepare('SELECT * FROM expenses WHERE expense_date LIKE ? ORDER BY expense_date DESC').all(`${date}%`);
        }
        return db_1.default.prepare('SELECT * FROM expenses ORDER BY expense_date DESC').all();
    });
    electron_1.ipcMain.handle('expenses:create', async (_event, data) => {
        const transaction = db_1.default.transaction(() => {
            const now = new Date().toISOString();
            const code = `EXP-${Date.now()}`;
            const expenseId = crypto.randomUUID();
            const expenseDate = data.date ? `${data.date}T00:00:00.000Z` : now;
            const amount = Number(data.amount || 0);
            const createdById = data.userId || (0, auth_ipc_1.getCurrentUser)()?.id || 'system';
            const shift = (0, businessDay_1.getOpenShift)();
            if (amount <= 0)
                throw new Error('Expense amount must be greater than zero');
            // INSERT expense
            db_1.default.prepare(`
        INSERT INTO expenses (id, code, shift_id, expense_date, category, description, amount, created_by_id, created_at, updated_at, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(expenseId, code, shift?.id || null, expenseDate, data.category, data.description, amount, createdById, now, now);
            (0, outboxHelper_1.createOutboxEntry)('expenses', 'INSERT', expenseId, {
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
            (0, cashRegister_1.addCashOut)(amount, shift?.shift_date || (0, businessDay_1.getActiveBusinessDate)(new Date(now)), shift?.id || null);
            return { success: true };
        });
        try {
            return transaction();
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('expenses:update', async (_event, id, data) => {
        try {
            const oldExpense = db_1.default.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
            if (!oldExpense)
                return { success: false, error: 'Expense not found' };
            const now = new Date().toISOString();
            const oldAmount = Number(oldExpense.amount || 0);
            const nextAmount = Number(data.amount ?? oldExpense.amount);
            if (nextAmount <= 0)
                return { success: false, error: 'Expense amount must be greater than zero' };
            db_1.default.prepare(`
        UPDATE expenses
        SET category = ?, description = ?, amount = ?, updated_at = ?, synced = 0
        WHERE id = ?
      `).run(data.category ?? oldExpense.category, data.description ?? oldExpense.description, nextAmount, now, id);
            (0, outboxHelper_1.createOutboxEntry)('expenses', 'UPDATE', id, {
                id,
                category: data.category ?? oldExpense.category,
                description: data.description ?? oldExpense.description,
                amount: nextAmount,
                updated_at: now
            });
            const difference = nextAmount - oldAmount;
            (0, cashRegister_1.adjustCashOut)(difference, oldExpense.shift_id ? undefined : String(oldExpense.expense_date).split('T')[0], oldExpense.shift_id || null);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('expenses:remove', async (_event, id) => {
        try {
            const oldExpense = db_1.default.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
            if (!oldExpense)
                return { success: false, error: 'Expense not found' };
            db_1.default.prepare('DELETE FROM expenses WHERE id = ?').run(id);
            (0, outboxHelper_1.createOutboxEntry)('expenses', 'DELETE', id, { id });
            (0, cashRegister_1.adjustCashOut)(-Number(oldExpense.amount || 0), oldExpense.shift_id ? undefined : String(oldExpense.expense_date).split('T')[0], oldExpense.shift_id || null);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('expenses:getSummary', () => {
        const row = db_1.default.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total
      FROM expenses
    `).get();
        return {
            count: Number(row?.count || 0),
            total: Number(row?.total || 0)
        };
    });
}
