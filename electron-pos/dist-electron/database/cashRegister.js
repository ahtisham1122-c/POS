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
exports.getTodayDate = getTodayDate;
exports.getCashRegisterExpected = getCashRegisterExpected;
exports.ensureOpenCashRegister = ensureOpenCashRegister;
exports.addCashIn = addCashIn;
exports.addCashOut = addCashOut;
exports.adjustCashOut = adjustCashOut;
const db_1 = __importDefault(require("./db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const businessDay_1 = require("./businessDay");
function getTodayDate() {
    return (0, businessDay_1.getActiveBusinessDate)();
}
function getRegister(date, shiftId) {
    if (shiftId) {
        const byShift = db_1.default.prepare('SELECT * FROM cash_register WHERE shift_id = ?').get(shiftId);
        if (byShift)
            return byShift;
    }
    return db_1.default.prepare('SELECT * FROM cash_register WHERE date = ? ORDER BY created_at DESC LIMIT 1').get(date);
}
function getCashRegisterExpected(date = getTodayDate(), shiftId) {
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
function ensureOpenCashRegister(date = getTodayDate(), shiftId) {
    const activeShift = shiftId ? null : (0, businessDay_1.getOpenShift)();
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
    db_1.default.prepare(`
    INSERT INTO cash_register (id, shift_id, date, opening_balance, cash_in, cash_out, closing_balance, is_closed_for_day, created_at, synced)
    VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, 0)
  `).run(id, resolvedShiftId, date, now);
    (0, outboxHelper_1.createOutboxEntry)('cash_register', 'INSERT', id, {
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
    return db_1.default.prepare('SELECT * FROM cash_register WHERE id = ?').get(id);
}
function addCashIn(amount, date = getTodayDate(), shiftId) {
    if (amount <= 0)
        return;
    const register = ensureOpenCashRegister(date, shiftId);
    const nextCashIn = Number(register.cash_in || 0) + amount;
    db_1.default.prepare('UPDATE cash_register SET cash_in = ?, synced = 0 WHERE id = ?').run(nextCashIn, register.id);
    (0, outboxHelper_1.createOutboxEntry)('cash_register', 'UPDATE', register.id, {
        id: register.id,
        shift_id: register.shift_id || shiftId || null,
        cash_in: nextCashIn,
        date
    });
}
function addCashOut(amount, date = getTodayDate(), shiftId) {
    if (amount <= 0)
        return;
    adjustCashOut(amount, date, shiftId);
}
function adjustCashOut(delta, date = getTodayDate(), shiftId) {
    if (delta === 0)
        return;
    const register = ensureOpenCashRegister(date, shiftId);
    const nextCashOut = Math.max(0, Number(register.cash_out || 0) + delta);
    db_1.default.prepare('UPDATE cash_register SET cash_out = ?, synced = 0 WHERE id = ?').run(nextCashOut, register.id);
    (0, outboxHelper_1.createOutboxEntry)('cash_register', 'UPDATE', register.id, {
        id: register.id,
        shift_id: register.shift_id || shiftId || null,
        cash_out: nextCashOut,
        date
    });
}
