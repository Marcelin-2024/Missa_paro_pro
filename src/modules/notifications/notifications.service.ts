import crypto from 'crypto';
import type { NotificationEntity } from '../platform/platform.types.js';
import {
  listNotificationsForParishRepo,
  listNotificationsForSuperAdminRepo,
  listTrackingNotificationsRepo,
  markNotificationReadRepo,
  saveNotificationRepo,
} from '../../repositories/auditNotifications.repository.js';

export async function createNotification(input: {
  userId?: string | null;
  parishId?: string | null;
  trackingRef?: string | null;
  audience: NotificationEntity['audience'];
  type: string;
  title: string;
  message: string;
}): Promise<NotificationEntity> {
  const record: NotificationEntity = {
    id: `notif-${crypto.randomUUID().slice(0, 12)}`,
    userId: input.userId ?? null,
    parishId: input.parishId ?? null,
    trackingRef: input.trackingRef ?? null,
    audience: input.audience,
    type: input.type,
    title: input.title,
    message: input.message,
    read: false,
    createdAt: new Date().toISOString(),
  };
  await saveNotificationRepo(record);
  return record;
}

export async function listNotificationsForParish(
  parishId: string,
  userId?: string
): Promise<NotificationEntity[]> {
  return listNotificationsForParishRepo(parishId, userId);
}

export async function listNotificationsForSuperAdmin(): Promise<NotificationEntity[]> {
  return listNotificationsForSuperAdminRepo();
}

export async function listTrackingNotifications(
  trackingRef: string
): Promise<NotificationEntity[]> {
  return listTrackingNotificationsRepo(trackingRef);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await markNotificationReadRepo(notificationId);
}
