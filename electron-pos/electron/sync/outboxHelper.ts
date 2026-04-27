import db from '../database/db';
import * as crypto from 'crypto';

export function createOutboxEntry(table: string, operation: string, recordId: string, payload: any) {
  const outboxId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO sync_outbox (id, table_name, operation, record_id, payload, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(outboxId, table, operation, recordId, JSON.stringify(payload), new Date().toISOString());
}
