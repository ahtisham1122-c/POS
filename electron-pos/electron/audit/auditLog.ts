import * as crypto from 'crypto';
import db from '../database/db';

type AuditInput = {
  actionType: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  actor?: { id?: string; name?: string; username?: string } | null;
  approvedBy?: { id?: string; name?: string } | null;
};

function safeJson(value: unknown) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'Unable to serialize audit value' });
  }
}

function hashAuditPayload(payload: Record<string, unknown>) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

export function calculateAuditHash(row: any, previousHash: string | null) {
  return hashAuditPayload({
    id: row.id,
    actionType: row.action_type,
    actorUserId: row.actor_user_id || null,
    actorName: row.actor_name || null,
    approvedById: row.approved_by_id || null,
    approvedByName: row.approved_by_name || null,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    beforeJson: row.before_json || null,
    afterJson: row.after_json || null,
    reason: row.reason || null,
    previousHash,
    createdAt: row.created_at
  });
}

export function logAudit(input: AuditInput) {
  const actor = input.actor || require('../ipc/auth.ipc').getCurrentUser?.();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const latest = db.prepare(`
    SELECT entry_hash
    FROM audit_logs
    WHERE entry_hash IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get() as any;
  const previousHash = latest?.entry_hash || null;
  const row = {
    id,
    action_type: input.actionType,
    actor_user_id: actor?.id || null,
    actor_name: actor?.name || actor?.username || null,
    approved_by_id: input.approvedBy?.id || null,
    approved_by_name: input.approvedBy?.name || null,
    entity_type: input.entityType || null,
    entity_id: input.entityId || null,
    before_json: safeJson(input.before),
    after_json: safeJson(input.after),
    reason: input.reason || null,
    created_at: createdAt
  };
  const entryHash = calculateAuditHash(row, previousHash);

  db.prepare(`
    INSERT INTO audit_logs (
      id, action_type, actor_user_id, actor_name, approved_by_id, approved_by_name,
      entity_type, entity_id, before_json, after_json, reason, previous_hash, entry_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.action_type,
    row.actor_user_id,
    row.actor_name,
    row.approved_by_id,
    row.approved_by_name,
    row.entity_type,
    row.entity_id,
    row.before_json,
    row.after_json,
    row.reason,
    previousHash,
    entryHash,
    row.created_at
  );
}
