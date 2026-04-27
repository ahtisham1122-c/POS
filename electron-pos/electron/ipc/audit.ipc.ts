import { ipcMain } from 'electron';
import db from '../database/db';
import { requireCurrentUser } from './auth.ipc';
import { calculateAuditHash } from '../audit/auditLog';

export function registerAuditIPC() {
  ipcMain.handle('audit:getAll', (_event, limit = 500) => {
    requireCurrentUser(['ADMIN', 'MANAGER']);
    return db.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 500, 2000)));
  });

  ipcMain.handle('audit:verifyIntegrity', () => {
    requireCurrentUser(['ADMIN', 'MANAGER']);
    const rows = db.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY created_at ASC
    `).all() as any[];

    let previousHash: string | null = null;
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

      const expectedHash = calculateAuditHash(row, previousHash);
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

  ipcMain.handle('audit:sealLegacy', () => {
    requireCurrentUser(['ADMIN']);
    const rows = db.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY created_at ASC
    `).all() as any[];

    return db.transaction(() => {
      let previousHash: string | null = null;
      let sealedCount = 0;
      const update = db.prepare(`
        UPDATE audit_logs
        SET previous_hash = ?, entry_hash = ?
        WHERE id = ?
      `);

      for (const row of rows) {
        const entryHash = calculateAuditHash(row, previousHash);
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
