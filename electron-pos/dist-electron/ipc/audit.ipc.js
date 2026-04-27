"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuditIPC = registerAuditIPC;
const electron_1 = require("electron");
const db_1 = __importDefault(require("../database/db"));
const auth_ipc_1 = require("./auth.ipc");
const auditLog_1 = require("../audit/auditLog");
function registerAuditIPC() {
    electron_1.ipcMain.handle('audit:getAll', (_event, limit = 500) => {
        (0, auth_ipc_1.requireCurrentUser)(['ADMIN', 'MANAGER']);
        return db_1.default.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 500, 2000)));
    });
    electron_1.ipcMain.handle('audit:verifyIntegrity', () => {
        (0, auth_ipc_1.requireCurrentUser)(['ADMIN', 'MANAGER']);
        const rows = db_1.default.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY created_at ASC
    `).all();
        let previousHash = null;
        let unsealedCount = 0;
        for (const row of rows) {
            if (!row.entry_hash) {
                unsealedCount += 1;
                continue;
            }
            if ((row.previous_hash || null) !== previousHash) {
                return {
                    success: false,
                    valid: false,
                    checked: rows.length,
                    badEntryId: row.id,
                    error: 'Audit chain is broken. A previous entry may have been changed or deleted.'
                };
            }
            const expectedHash = (0, auditLog_1.calculateAuditHash)(row, previousHash);
            if (expectedHash !== row.entry_hash) {
                return {
                    success: false,
                    valid: false,
                    checked: rows.length,
                    badEntryId: row.id,
                    error: 'Audit entry hash does not match. This entry may have been edited.'
                };
            }
            previousHash = row.entry_hash;
        }
        if (unsealedCount > 0) {
            return {
                success: false,
                valid: false,
                checked: rows.length,
                unsealedCount,
                error: `${unsealedCount} older audit log(s) are not sealed yet. Seal legacy logs before using the app in production.`
            };
        }
        return { success: true, valid: true, checked: rows.length, unsealedCount: 0 };
    });
    electron_1.ipcMain.handle('audit:sealLegacy', () => {
        (0, auth_ipc_1.requireCurrentUser)(['ADMIN']);
        const rows = db_1.default.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY created_at ASC
    `).all();
        return db_1.default.transaction(() => {
            let previousHash = null;
            let sealedCount = 0;
            const update = db_1.default.prepare(`
        UPDATE audit_logs
        SET previous_hash = ?, entry_hash = ?
        WHERE id = ?
      `);
            for (const row of rows) {
                const entryHash = (0, auditLog_1.calculateAuditHash)(row, previousHash);
                if (row.previous_hash !== previousHash || row.entry_hash !== entryHash) {
                    update.run(previousHash, entryHash, row.id);
                    sealedCount += 1;
                }
                previousHash = entryHash;
            }
            return { success: true, sealedCount, checked: rows.length };
        })();
    });
}
