import crypto from 'crypto';
import { getPlatformState, savePlatformState } from '../platform/platform.repository.js';
import type { AuditLogEntity } from '../platform/platform.types.js';

export function recordAuditLog(input: {
  actorUserId: string | null;
  actorEmail: string;
  scope: 'GLOBAL' | 'PARISH' | 'PUBLIC';
  parishId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}): AuditLogEntity {
  const state = getPlatformState();
  const entry: AuditLogEntity = {
    id: `audit-${crypto.randomUUID().slice(0, 12)}`,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: input.scope,
    parishId: input.parishId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary,
    createdAt: new Date().toISOString(),
  };
  state.auditLogs.unshift(entry);
  if (state.auditLogs.length > 500) {
    state.auditLogs.length = 500;
  }
  savePlatformState(state);
  return entry;
}

export function listAuditLogs(filter: {
  scope?: 'GLOBAL' | 'PARISH' | 'PUBLIC';
  parishId?: string;
  limit?: number;
}): AuditLogEntity[] {
  const state = getPlatformState();
  let rows = state.auditLogs;
  if (filter.scope) {
    rows = rows.filter((log) => log.scope === filter.scope);
  }
  if (filter.parishId) {
    rows = rows.filter((log) => log.parishId === filter.parishId);
  }
  return rows.slice(0, filter.limit ?? 100);
}
