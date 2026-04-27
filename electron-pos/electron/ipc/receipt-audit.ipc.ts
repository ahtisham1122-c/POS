import { ipcMain } from 'electron';
import db from '../database/db';
import * as crypto from 'crypto';
import { createOutboxEntry } from '../sync/outboxHelper';
import { getCurrentUser } from './auth.ipc';

type AuditInput = {
  date: string;
  billNumbers: string[];
  notes?: string;
};

function normalizeBillNumber(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function buildAudit(input: AuditInput) {
  const date = input.date;
  const sales = db.prepare(`
    SELECT id, bill_number, grand_total, payment_type, status, sale_date
    FROM sales
    WHERE sale_date LIKE ?
    ORDER BY sale_date ASC
  `).all(`${date}%`) as any[];

  const salesByBill = new Map(sales.map((sale) => [sale.bill_number.toUpperCase(), sale]));
  const expectedAmount = sales.reduce((sum, sale) => sum + Number(sale.grand_total || 0), 0);

  const seen = new Set<string>();
  const matched: any[] = [];
  const extra: any[] = [];
  const duplicates: any[] = [];

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
    } else {
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

export function registerReceiptAuditIPC() {
  ipcMain.handle('receiptAudit:preview', (_event, input: AuditInput) => {
    try {
      return { success: true, audit: buildAudit(input) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('receiptAudit:save', (_event, input: AuditInput) => {
    try {
      return db.transaction(() => {
        const audit = buildAudit(input);
        const now = new Date().toISOString();
        const sessionId = crypto.randomUUID();
        const countedById = getCurrentUser()?.id || 'system';

        db.prepare(`
          INSERT INTO receipt_audit_sessions (
            id, audit_date, counted_by_id, expected_count, expected_amount,
            counted_count, counted_amount, missing_count, missing_amount,
            extra_count, duplicate_count, notes, created_at, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
          sessionId,
          audit.date,
          countedById,
          audit.expectedCount,
          audit.expectedAmount,
          audit.countedCount,
          audit.countedAmount,
          audit.missingCount,
          audit.missingAmount,
          audit.extraCount,
          audit.duplicateCount,
          input.notes || null,
          now
        );

        createOutboxEntry('receipt_audit_sessions', 'INSERT', sessionId, {
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

        const insertEntry = db.prepare(`
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
          insertEntry.run(
            entryId,
            sessionId,
            entry.billNumber,
            entry.saleId,
            entry.amount,
            entry.status,
            now
          );

          createOutboxEntry('receipt_audit_entries', 'INSERT', entryId, {
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
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('receiptAudit:getHistory', (_event, limit = 30) => {
    return db.prepare(`
      SELECT *
      FROM receipt_audit_sessions
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit) || 30, 100)));
  });

  ipcMain.handle('receiptAudit:getLatestForDate', (_event, date: string) => {
    const session = db.prepare(`
      SELECT *
      FROM receipt_audit_sessions
      WHERE audit_date = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(date) as any;

    if (!session) return null;

    const entries = db.prepare(`
      SELECT *
      FROM receipt_audit_entries
      WHERE session_id = ?
      ORDER BY status, bill_number
    `).all(session.id);

    return { ...session, entries };
  });
}
