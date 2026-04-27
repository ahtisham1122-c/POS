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
exports.calculateAuditHash = calculateAuditHash;
exports.logAudit = logAudit;
const crypto = __importStar(require("crypto"));
const db_1 = __importDefault(require("../database/db"));
function safeJson(value) {
    if (value === undefined)
        return null;
    try {
        return JSON.stringify(value);
    }
    catch {
        return JSON.stringify({ error: 'Unable to serialize audit value' });
    }
}
function hashAuditPayload(payload) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
}
function calculateAuditHash(row, previousHash) {
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
function logAudit(input) {
    const actor = input.actor || require('../ipc/auth.ipc').getCurrentUser?.();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const latest = db_1.default.prepare(`
    SELECT entry_hash
    FROM audit_logs
    WHERE entry_hash IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get();
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
    db_1.default.prepare(`
    INSERT INTO audit_logs (
      id, action_type, actor_user_id, actor_name, approved_by_id, approved_by_name,
      entity_type, entity_id, before_json, after_json, reason, previous_hash, entry_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.action_type, row.actor_user_id, row.actor_name, row.approved_by_id, row.approved_by_name, row.entity_type, row.entity_id, row.before_json, row.after_json, row.reason, previousHash, entryHash, row.created_at);
}
