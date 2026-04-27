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
exports.registerCashRegisterIPC = registerCashRegisterIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const auth_ipc_1 = require("./auth.ipc");
const cashRegister_1 = require("../database/cashRegister");
const businessDay_1 = require("../database/businessDay");
const backup_1 = require("../sync/backup");
function registerCashRegisterIPC() {
    electron_1.ipcMain.handle('cashRegister:getToday', () => {
        const openShift = (0, businessDay_1.getOpenShift)();
        const date = openShift?.shift_date || (0, businessDay_1.getActiveBusinessDate)();
        const { register, openingCash, cashIn, cashOut, expectedCash } = (0, cashRegister_1.getCashRegisterExpected)(date, openShift?.id);
        if (!register)
            return null;
        return {
            ...register,
            shift_id: register.shift_id || openShift?.id || null,
            opening_cash: openingCash,
            cash_in_total: cashIn,
            cash_out_total: cashOut,
            expected_cash: expectedCash
        };
    });
    electron_1.ipcMain.handle('cashRegister:open', (_event, data) => {
        try {
            const now = new Date().toISOString();
            const openShift = (0, businessDay_1.getOpenShift)();
            const date = openShift?.shift_date || (0, businessDay_1.formatLocalDate)(new Date());
            const existing = openShift
                ? db_1.default.prepare('SELECT * FROM cash_register WHERE shift_id = ?').get(openShift.id)
                : db_1.default.prepare('SELECT * FROM cash_register WHERE date = ? AND is_closed_for_day = 0').get(date);
            if (existing)
                return { success: false, error: 'Cash register is already opened for today' };
            const id = crypto.randomUUID();
            const openingBalance = Number(data?.openingBalance || 0);
            db_1.default.prepare(`
        INSERT INTO cash_register (id, shift_id, date, opening_balance, cash_in, cash_out, closing_balance, is_closed_for_day, created_at, synced)
        VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, 0)
      `).run(id, openShift?.id || null, date, openingBalance, openingBalance, now);
            (0, outboxHelper_1.createOutboxEntry)('cash_register', 'INSERT', id, {
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
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('cashRegister:close', (_event, data) => {
        try {
            const now = new Date().toISOString();
            const openShift = (0, businessDay_1.getOpenShift)();
            const date = openShift?.shift_date || (0, businessDay_1.getActiveBusinessDate)();
            const row = openShift
                ? db_1.default.prepare('SELECT * FROM cash_register WHERE shift_id = ? OR (shift_id IS NULL AND date = ?) ORDER BY created_at DESC LIMIT 1').get(openShift.id, date)
                : db_1.default.prepare('SELECT * FROM cash_register WHERE date = ? ORDER BY created_at DESC LIMIT 1').get(date);
            if (!row)
                return { success: false, error: 'Cash register is not opened for today' };
            if (Number(row.is_closed_for_day) === 1)
                return { success: false, error: 'Cash register is already closed' };
            const receiptAudit = db_1.default.prepare(`
        SELECT *
        FROM receipt_audit_sessions
        WHERE audit_date = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(date);
            if (!receiptAudit) {
                return {
                    success: false,
                    requiresReceiptAudit: true,
                    error: 'Please complete Receipt Audit before closing the cash register'
                };
            }
            const physicalCash = Number(data.closingBalance);
            if (!Number.isFinite(physicalCash) || physicalCash < 0) {
                return { success: false, error: 'Please enter a valid counted cash amount' };
            }
            const { expectedCash } = (0, cashRegister_1.getCashRegisterExpected)(date, openShift?.id);
            const variance = Number((physicalCash - expectedCash).toFixed(2));
            db_1.default.prepare(`
        UPDATE cash_register
        SET closing_balance = ?, is_closed_for_day = 1, synced = 0
        WHERE id = ?
      `).run(physicalCash, row.id);
            (0, outboxHelper_1.createOutboxEntry)('cash_register', 'UPDATE', row.id, {
                id: row.id,
                shift_id: openShift?.id || row.shift_id || null,
                date,
                closing_balance: physicalCash,
                is_closed_for_day: 1,
                updated_at: now
            });
            if (openShift) {
                const closedById = (0, auth_ipc_1.getCurrentUser)()?.id || 'system';
                db_1.default.prepare(`
          UPDATE shifts
          SET closed_by_id = ?, closed_at = ?, expected_cash = ?, closing_cash = ?,
              cash_variance = ?, receipt_audit_session_id = ?, status = 'CLOSED', synced = 0
          WHERE id = ?
        `).run(closedById, now, expectedCash, physicalCash, variance, receiptAudit.id, openShift.id);
                (0, outboxHelper_1.createOutboxEntry)('shifts', 'UPDATE', openShift.id, {
                    id: openShift.id,
                    closed_by_id: closedById,
                    closed_at: now,
                    expected_cash: expectedCash,
                    closing_cash: physicalCash,
                    cash_variance: variance,
                    receipt_audit_session_id: receiptAudit.id,
                    status: 'CLOSED'
                });
            }
            (0, backup_1.performBackup)(false);
            return { success: true, closingBalance: physicalCash, expectedCash, variance };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('cashRegister:getHistory', () => {
        return db_1.default.prepare('SELECT * FROM cash_register ORDER BY date DESC LIMIT 30').all().map((row) => {
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
