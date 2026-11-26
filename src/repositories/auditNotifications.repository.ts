import { getAdminDb } from '../config/firebaseAdmin.js';
import type { AuditLogEntity, NotificationEntity } from '../modules/platform/platform.types.js';
import { COLLECTIONS, stripUndefined } from './collections.js';

function auditCol() {
  return getAdminDb().collection(COLLECTIONS.AUDIT_LOGS);
}
function notifCol() {
  return getAdminDb().collection(COLLECTIONS.NOTIFICATIONS);
}

export async function saveAuditLogRepo(entry: AuditLogEntity): Promise<void> {
  await auditCol().doc(entry.id).set(stripUndefined({ ...entry }));
}

export async function listAuditLogsRepo(filter: {
  scope?: 'GLOBAL' | 'PARISH' | 'PUBLIC';
  parishId?: string;
  limit?: number;
}): Promise<AuditLogEntity[]> {
  let snap;
  if (filter.parishId) {
    snap = await auditCol().where('parishId', '==', filter.parishId).get();
  } else if (filter.scope) {
    snap = await auditCol().where('scope', '==', filter.scope).get();
  } else {
    snap = await auditCol().get();
  }

  let rows = snap.docs.map((d) => d.data() as AuditLogEntity);
  if (filter.scope) {
    rows = rows.filter((log) => log.scope === filter.scope);
  }
  if (filter.parishId) {
    rows = rows.filter((log) => log.parishId === filter.parishId);
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.slice(0, filter.limit ?? 100);
}

export async function saveNotificationRepo(record: NotificationEntity): Promise<void> {
  await notifCol().doc(record.id).set(stripUndefined({ ...record }));
}

export async function listNotificationsForParishRepo(
  parishId: string,
  userId?: string
): Promise<NotificationEntity[]> {
  const byParishSnap = await notifCol().where('parishId', '==', parishId).get();
  const map = new Map<string, NotificationEntity>();

  for (const doc of byParishSnap.docs) {
    const n = doc.data() as NotificationEntity;
    if (n.audience === 'PARISH_STAFF' || n.audience === 'PARISH_ADMIN') {
      map.set(n.id, n);
    }
  }

  if (userId) {
    const byUserSnap = await notifCol().where('userId', '==', userId).get();
    for (const doc of byUserSnap.docs) {
      const n = doc.data() as NotificationEntity;
      map.set(n.id, n);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);
}

export async function listNotificationsForSuperAdminRepo(): Promise<NotificationEntity[]> {
  const snap = await notifCol()
    .where('audience', 'in', ['SUPER_ADMIN', 'PARISH_ADMIN'])
    .get();
  return snap.docs
    .map((d) => d.data() as NotificationEntity)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);
}

export async function listTrackingNotificationsRepo(
  trackingRef: string
): Promise<NotificationEntity[]> {
  const snap = await notifCol().where('trackingRef', '==', trackingRef).get();
  return snap.docs
    .map((d) => d.data() as NotificationEntity)
    .filter((n) => n.audience === 'FIDELE')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markNotificationReadRepo(notificationId: string): Promise<void> {
  if (!notificationId) return;
  const ref = notifCol().doc(notificationId);
  const snap = await ref.get();
  if (snap.exists && !(snap.data() as NotificationEntity).read) {
    await ref.update({ read: true });
  }
}
