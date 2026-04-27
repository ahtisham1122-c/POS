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
exports.registerShiftsIPC = registerShiftsIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const auth_ipc_1 = require("./auth.ipc");
const cashRegister_1 = require("../database/cashRegister");
const businessDay_1 = require("../database/businessDay");
const backup_1 = require("../sync/backup");
function getLatestReceiptAudit(date) {
    return db_1.default.prepare(`
    SELECT *
    FROM receipt_audit_sessions
    WHERE audit_date = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(date);
}
function registerShiftsIPC() {
    electron_1.ipcMain.handle('shifts:getCurrent', () => {
        return db_1.default.prepare(`
      SELECT s.*, opener.name as opened_by_name, closer.name as closed_by_name
      FROM shifts s
      LEFT JOIN users opener ON opener.id = s.opened_by_id
      LEFT JOIN users closer ON closer.id = s.closed_by_id
      WHERE s.status = 'OPEN'
      ORDER BY s.opened_at DESC
      LIMIT 1
    `).get() || null;
    });
    electron_1.ipcMain.handle('shifts:getToday', () => {
        return db_1.default.prepare(`
      SELECT s.*, opener.name as opened_by_name, closer.name as closed_by_name
      FROM shifts s
      LEFT JOIN users opener ON opener.id = s.opened_by_id
      LEFT JOIN users closer ON closer.id = s.closed_by_id
      WHERE s.shift_date = ?
      ORDER BY s.opened_at DESC
      LIMIT 1
    `).get((0, businessDay_1.getActiveBusinessDate)()) || null;
    });
    electron_1.ipcMain.handle('shifts:open', (_event, data) => {
        try {
            return db_1.default.transaction(() => {
                const existingOpen = db_1.default.prepare("SELECT id FROM shifts WHERE status = 'OPEN' LIMIT 1").get();
                if (existingOpen) {
                    return { success: false, error: 'A shift is already open' };
                }
                const now = new Date().toISOString();
                const nowDate = new Date();
                const date = (0, businessDay_1.formatLocalDate)(nowDate);
                if ((0, businessDay_1.shouldWarnBeforeOpeningShift)(nowDate) && !data?.confirmAfterMidnightOpen) {
                    return {
                        success: false,
                        requiresPreviousShiftConfirmation: true,
                        error: "A shift from yesterday may still be open. Do you want to close yesterday's shift first before opening a new one?"
                    };
                }
                const user = (0, auth_ipc_1.getCurrentUser)();
                const openedById = user?.id || 'system';
                const openingCash = Number(data?.openingCash || 0);
                if (!Number.isFinite(openingCash) || openingCash < 0) {
                    return { success: false, error: 'Opening cash must be zero or more' };
                }
                const shiftId = crypto.randomUUID();
                const existingRegister = db_1.default.prepare('SELECT * FROM cash_register WHERE date = ? AND is_closed_for_day = 0').get(date);
                if (!existingRegister) {
                    const registerId = crypto.randomUUID();
                    db_1.default.prepare(`
            INSERT INTO cash_register (id, shift_id, date, opening_balance, cash_in, cash_out, closing_balance, is_closed_for_day, created_at, synced)
            VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, 0)
          `).run(registerId, shiftId, date, openingCash, openingCash, now);
                    (0, outboxHelper_1.createOutboxEntry)('cash_register', 'INSERT', registerId, {
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
                }
                else if (!existingRegister.shift_id) {
                    db_1.default.prepare('UPDATE cash_register SET shift_id = ?, synced = 0 WHERE id = ?').run(shiftId, existingRegister.id);
                    (0, outboxHelper_1.createOutboxEntry)('cash_register', 'UPDATE', existingRegister.id, {
                        id: existingRegister.id,
                        shift_id: shiftId,
                        date,
                        updated_at: now
                    });
                }
                db_1.default.prepare(`
          INSERT INTO shifts (
            id, shift_date, opened_by_id, opened_at, opening_cash,
            expected_cash, status, notes, synced
          ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, 0)
        `).run(shiftId, date, openedById, now, openingCash, openingCash, data?.notes || null);
                (0, outboxHelper_1.createOutboxEntry)('shifts', 'INSERT', shiftId, {
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
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('shifts:close', (_event, data) => {
        try {
            const result = db_1.default.transaction(() => {
                const shift = db_1.default.prepare("SELECT * FROM shifts WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get();
                if (!shift)
                    return { success: false, error: 'No open shift found' };
                const receiptAudit = getLatestReceiptAudit(shift.shift_date);
                if (!receiptAudit) {
                    return {
                        success: false,
                        requiresReceiptAudit: true,
                        error: 'Please complete Receipt Audit before closing the shift'
                    };
                }
                const now = new Date().toISOString();
                const closedById = (0, auth_ipc_1.getCurrentUser)()?.id || 'system';
                const expectedCash = (0, cashRegister_1.getCashRegisterExpected)(shift.shift_date, shift.id).expectedCash;
                const closingCash = Number(data?.closingCash || 0);
                if (!Number.isFinite(closingCash) || closingCash < 0) {
                    return { success: false, error: 'Closing cash must be zero or more' };
                }
                const variance = Number((closingCash - expectedCash).toFixed(2));
                const register = db_1.default.prepare('SELECT * FROM cash_register WHERE shift_id = ? OR (shift_id IS NULL AND date = ?) ORDER BY created_at DESC LIMIT 1').get(shift.id, shift.shift_date);
                if (!register) {
                    return { success: false, error: 'Cash register was not opened for this shift date' };
                }
                if (Number(register.is_closed_for_day || 0) === 1) {
                    return { success: false, error: 'Cash register is already closed for this date' };
                }
                db_1.default.prepare(`
          UPDATE shifts
          SET closed_by_id = ?, closed_at = ?, expected_cash = ?, closing_cash = ?,
              cash_variance = ?, receipt_audit_session_id = ?, status = 'CLOSED',
              notes = ?, synced = 0
          WHERE id = ?
        `).run(closedById, now, expectedCash, closingCash, variance, receiptAudit.id, data?.notes || shift.notes || null, shift.id);
                db_1.default.prepare(`
          UPDATE cash_register
          SET closing_balance = ?, is_closed_for_day = 1, synced = 0
          WHERE id = ?
        `).run(closingCash, register.id);
                (0, outboxHelper_1.createOutboxEntry)('shifts', 'UPDATE', shift.id, {
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
                (0, outboxHelper_1.createOutboxEntry)('cash_register', 'UPDATE', register.id, {
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
                (0, backup_1.performBackup)(false);
            }
            return result;
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('shifts:getHistory', (_event, limit = 30) => {
        return db_1.default.prepare(`
      SELECT s.*, opener.name as opened_by_name, closer.name as closed_by_name
      FROM shifts s
      LEFT JOIN users opener ON opener.id = s.opened_by_id
      LEFT JOIN users closer ON closer.id = s.closed_by_id
      ORDER BY s.opened_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 30, 100)));
    });
}
