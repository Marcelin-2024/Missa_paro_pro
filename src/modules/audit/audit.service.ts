import crypto from 'crypto';
import type { AuditLogEntity } from '../platform/platform.types.js';
import {
  listAuditLogsRepo,
  saveAuditLogRepo,
} from '../../repositories/auditNotifications.repository.js';

export async function recordAuditLog(input: {
  actorUserId: string | null;
  actorEmail: string;
  scope: 'GLOBAL' | 'PARISH' | 'PUBLIC';
  parishId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}): Promise<AuditLogEntity> {
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
  await saveAuditLogRepo(entry);
  return entry;
}

export async function listAuditLogs(filter: {
  scope?: 'GLOBAL' | 'PARISH' | 'PUBLIC';
  parishId?: string;
  limit?: number;
}): Promise<AuditLogEntity[]> {
  return listAuditLogsRepo(filter);
}
