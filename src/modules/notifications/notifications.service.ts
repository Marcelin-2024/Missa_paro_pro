import crypto from 'crypto';
import { getPlatformState, savePlatformState } from '../platform/platform.repository.js';
import type { NotificationEntity } from '../platform/platform.types.js';

export function createNotification(input: {
  userId?: string | null;
  parishId?: string | null;
  trackingRef?: string | null;
  audience: NotificationEntity['audience'];
  type: string;
  title: string;
  message: string;
}): NotificationEntity {
  const state = getPlatformState();
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
  state.notifications.unshift(record);
  if (state.notifications.length > 400) {
    state.notifications.length = 400;
  }
  savePlatformState(state);
  return record;
}

export function listNotificationsForParish(parishId: string, userId?: string): NotificationEntity[] {
  const state = getPlatformState();
  return state.notifications
    .filter(
      (n) =>
        (n.parishId === parishId &&
          (n.audience === 'PARISH_STAFF' || n.audience === 'PARISH_ADMIN')) ||
        (userId && n.userId === userId)
    )
    .slice(0, 30);
}

export function listNotificationsForSuperAdmin(): NotificationEntity[] {
  const state = getPlatformState();
  return state.notifications
    .filter((n) => n.audience === 'SUPER_ADMIN' || n.audience === 'PARISH_ADMIN')
    .slice(0, 30);
}

export function listTrackingNotifications(trackingRef: string): NotificationEntity[] {
  const state = getPlatformState();
  return state.notifications.filter(
    (n) => n.trackingRef === trackingRef && n.audience === 'FIDELE'
  );
}

export function markNotificationRead(notificationId: string): void {
  const state = getPlatformState();
  const target = state.notifications.find((n) => n.id === notificationId);
  if (target && !target.read) {
    target.read = true;
    savePlatformState(state);
  }
}
