import { getDb } from './db';
import type { ActorType, AuditEntry } from './types';

/**
 * Append-only audit trail (Full Spec v2 §6).
 * Every payment, dispatch, refund and account decision lands here. This is Paylo's
 * only evidence in a dispute, so entries are written, never updated or deleted.
 */
export function audit(
  actorType: ActorType, actorId: string | null, actorLabel: string | null,
  entityType: string, entityId: string, action: string, detail?: unknown,
) {
  getDb().prepare(
    'INSERT INTO audit_log (actor_type, actor_id, actor_label, entity_type, entity_id, action, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(actorType, actorId, actorLabel, entityType, entityId, action,
    detail === undefined ? null : typeof detail === 'string' ? detail : JSON.stringify(detail));
}

export function auditFor(entityType: string, entityId: string): AuditEntry[] {
  return getDb().prepare('SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC').all(entityType, entityId) as AuditEntry[];
}

export function recentAudit(limit = 200, entityType?: string): AuditEntry[] {
  return entityType
    ? getDb().prepare('SELECT * FROM audit_log WHERE entity_type = ? ORDER BY id DESC LIMIT ?').all(entityType, limit) as AuditEntry[]
    : getDb().prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as AuditEntry[];
}
