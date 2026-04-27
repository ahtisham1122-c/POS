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
exports.registerReceiptAuditIPC = registerReceiptAuditIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const auth_ipc_1 = require("./auth.ipc");
function normalizeBillNumber(value) {
    return value.trim().toUpperCase().replace(/\s+/g, '');
}
function buildAudit(input) {
    const date = input.date;
    const sales = db_1.default.prepare(`
    SELECT id, bill_number, grand_total, payment_type, status, sale_date
    FROM sales
    WHERE sale_date LIKE ?
    ORDER BY sale_date ASC
  `).all(`${date}%`);
    const salesByBill = new Map(sales.map((sale) => [sale.bill_number.toUpperCase(), sale]));
    const expectedAmount = sales.reduce((sum, sale) => sum + Number(sale.grand_total || 0), 0);
    const seen = new Set();
    const matched = [];
    const extra = [];
    const duplicates = [];
    const cleanedBills = input.billNumbers
        .map(normalizeBillNumber)
        .filter(Boolean);
    for (const billNumber of cleanedBills) {
        if (seen.has(billNumber)) {
            const sale = salesByBill.get(billNumber);
            duplicates.push({
                billNumber,
                saleId: sale?.id || null,
                amount: Number(sale?.grand_total || 0),
                status: 'DUPLICATE'
            });
            continue;
        }
        seen.add(billNumber);
        const sale = salesByBill.get(billNumber);
        if (sale) {
            matched.push({
                billNumber,
                saleId: sale.id,
                amount: Number(sale.grand_total || 0),
                status: 'MATCHED'
            });
        }
        else {
            extra.push({
                billNumber,
                saleId: null,
                amount: 0,
                status: 'EXTRA'
            });
        }
    }
    const matchedSet = new Set(matched.map((entry) => entry.billNumber));
    const missing = sales
        .filter((sale) => !matchedSet.has(sale.bill_number.toUpperCase()))
        .map((sale) => ({
        billNumber: sale.bill_number,
        saleId: sale.id,
        amount: Number(sale.grand_total || 0),
        status: 'MISSING'
    }));
    const countedAmount = matched.reduce((sum, entry) => sum + entry.amount, 0);
    const missingAmount = missing.reduce((sum, entry) => sum + entry.amount, 0);
    return {
        date,
        expectedCount: sales.length,
        expectedAmount,
        countedCount: matched.length,
        countedAmount,
        missingCount: missing.length,
        missingAmount,
        extraCount: extra.length,
        duplicateCount: duplicates.length,
        differenceAmount: expectedAmount - countedAmount,
        matched,
        missing,
        extra,
        duplicates
    };
}
function registerReceiptAuditIPC() {
    electron_1.ipcMain.handle('receiptAudit:preview', (_event, input) => {
        try {
            return { success: true, audit: buildAudit(input) };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('receiptAudit:save', (_event, input) => {
        try {
            return db_1.default.transaction(() => {
                const audit = buildAudit(input);
                const now = new Date().toISOString();
                const sessionId = crypto.randomUUID();
                const countedById = (0, auth_ipc_1.getCurrentUser)()?.id || 'system';
                db_1.default.prepare(`
          INSERT INTO receipt_audit_sessions (
            id, audit_date, counted_by_id, expected_count, expected_amount,
            counted_count, counted_amount, missing_count, missing_amount,
            extra_count, duplicate_count, notes, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(sessionId, audit.date, countedById, audit.expectedCount, audit.expectedAmount, audit.countedCount, audit.countedAmount, audit.missingCount, audit.missingAmount, audit.extraCount, audit.duplicateCount, input.notes || null, now);
                (0, outboxHelper_1.createOutboxEntry)('receipt_audit_sessions', 'INSERT', sessionId, {
                    id: sessionId,
                    audit_date: audit.date,
                    counted_by_id: countedById,
                    expected_count: audit.expectedCount,
                    expected_amount: audit.expectedAmount,
                    counted_count: audit.countedCount,
                    counted_amount: audit.countedAmount,
                    missing_count: audit.missingCount,
                    missing_amount: audit.missingAmount,
                    extra_count: audit.extraCount,
                    duplicate_count: audit.duplicateCount,
                    notes: input.notes || null,
                    created_at: now
                });
                const insertEntry = db_1.default.prepare(`
          INSERT INTO receipt_audit_entries (
            id, session_id, bill_number, sale_id, amount, status, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `);
                const allEntries = [
                    ...audit.matched,
                    ...audit.missing,
                    ...audit.extra,
                    ...audit.duplicates
                ];
                for (const entry of allEntries) {
                    const entryId = crypto.randomUUID();
                    insertEntry.run(entryId, sessionId, entry.billNumber, entry.saleId, entry.amount, entry.status, now);
                    (0, outboxHelper_1.createOutboxEntry)('receipt_audit_entries', 'INSERT', entryId, {
                        id: entryId,
                        session_id: sessionId,
                        bill_number: entry.billNumber,
                        sale_id: entry.saleId,
                        amount: entry.amount,
                        status: entry.status,
                        created_at: now
                    });
                }
                return { success: true, sessionId, audit };
            })();
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle('receiptAudit:getHistory', (_event, limit = 30) => {
        return db_1.default.prepare(`
      SELECT *
      FROM receipt_audit_sessions
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 30, 100)));
    });
    electron_1.ipcMain.handle('receiptAudit:getLatestForDate', (_event, date) => {
        const session = db_1.default.prepare(`
      SELECT *
      FROM receipt_audit_sessions
      WHERE audit_date = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(date);
        if (!session)
            return null;
        const entries = db_1.default.prepare(`
      SELECT *
      FROM receipt_audit_entries
      WHERE session_id = ?
      ORDER BY status, bill_number
    `).all(session.id);
        return { ...session, entries };
    });
}
