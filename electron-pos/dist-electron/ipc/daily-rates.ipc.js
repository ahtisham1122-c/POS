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
exports.registerDailyRatesIPC = registerDailyRatesIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const crypto = __importStar(require("crypto"));
const outboxHelper_1 = require("../sync/outboxHelper");
const auth_ipc_1 = require("./auth.ipc");
const auditLog_1 = require("../audit/auditLog");
const businessDay_1 = require("../database/businessDay");
function requirePositiveRate(value, fieldName) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`${fieldName} must be greater than zero`);
    }
    return rate;
}
function registerDailyRatesIPC() {
    electron_1.ipcMain.handle('dailyRates:getToday', () => {
        const today = (0, businessDay_1.getBusinessDate)();
        const row = db_1.default.prepare('SELECT * FROM daily_rates WHERE date = ?').get(today);
        if (row)
            return row;
        return db_1.default.prepare('SELECT * FROM daily_rates ORDER BY date DESC LIMIT 1').get() || null;
    });
    electron_1.ipcMain.handle('dailyRates:update', (_event, data) => {
        try {
            const user = (0, auth_ipc_1.requireCurrentUser)();
            const approver = (0, auth_ipc_1.requireManagerApproval)(data.managerPin, 'changing daily rates');
            const now = new Date().toISOString();
            const date = data.date || (0, businessDay_1.getBusinessDate)();
            const existing = db_1.default.prepare('SELECT * FROM daily_rates WHERE date = ?').get(date);
            const id = existing?.id || crypto.randomUUID();
            const milkRate = requirePositiveRate(data.milkRate, 'Milk rate');
            const yogurtRate = requirePositiveRate(data.yogurtRate, 'Yogurt rate');
            if (existing) {
                db_1.default.prepare(`
          UPDATE daily_rates
          SET milk_rate = ?, yogurt_rate = ?, updated_by_id = ?, synced = 0
          WHERE date = ?
        `).run(milkRate, yogurtRate, user.id, date);
                (0, outboxHelper_1.createOutboxEntry)('daily_rates', 'UPDATE', id, {
                    id,
                    date,
                    milk_rate: milkRate,
                    yogurt_rate: yogurtRate,
                    updated_by_id: user.id,
                    created_at: existing.created_at
                });
            }
            else {
                db_1.default.prepare(`
          INSERT INTO daily_rates (id, date, milk_rate, yogurt_rate, updated_by_id, created_at, synced)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(id, date, milkRate, yogurtRate, user.id, now);
                (0, outboxHelper_1.createOutboxEntry)('daily_rates', 'INSERT', id, {
                    id,
                    date,
                    milk_rate: milkRate,
                    yogurt_rate: yogurtRate,
                    updated_by_id: user.id,
                    created_at: now
                });
            }
            (0, auditLog_1.logAudit)({
                actionType: 'DAILY_RATES_CHANGED',
                entityType: 'daily_rates',
                entityId: id,
                before: existing ? { milkRate: existing.milk_rate, yogurtRate: existing.yogurt_rate } : null,
                after: { milkRate, yogurtRate, date },
                approvedBy: approver
            });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
}
