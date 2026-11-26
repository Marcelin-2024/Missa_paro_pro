import { getAdminDb } from '../config/firebaseAdmin.js';
import type { PlatformSettingsEntity } from '../modules/platform/platform.types.js';
import { COLLECTIONS, stripUndefined } from './collections.js';

export interface SystemBootstrapMetadata {
  version: number;
  superAdminClaimed: boolean;
  bootstrappedAt?: string;
  migratedAt?: string;
  seededAt?: string;
  source?: string;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsEntity = {
  platformName: 'Missa Paro — Côte d’Ivoire',
  supportEmail: 'support@missaparo.ci',
  tempPasswordTtlHours: 48,
  activationLinkTtlHours: 48,
  allowPublicFideleSignup: true,
  requireCureAnnouncementApproval: false,
};

export async function getSystemMetadata(): Promise<SystemBootstrapMetadata> {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.SYSTEM_METADATA).doc('bootstrap').get();
  if (!snap.exists) {
    return { version: 1, superAdminClaimed: false };
  }
  const data = snap.data() as Partial<SystemBootstrapMetadata>;
  return {
    version: typeof data.version === 'number' ? data.version : 1,
    superAdminClaimed: Boolean(data.superAdminClaimed),
    bootstrappedAt: data.bootstrappedAt,
    migratedAt: data.migratedAt,
    seededAt: data.seededAt,
    source: data.source,
  };
}

export async function saveSystemMetadata(meta: SystemBootstrapMetadata): Promise<void> {
  const db = getAdminDb();
  await db
    .collection(COLLECTIONS.SYSTEM_METADATA)
    .doc('bootstrap')
    .set(stripUndefined({ ...meta }), { merge: true });
}

export async function getPlatformSettings(): Promise<PlatformSettingsEntity> {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc('global').get();
  if (!snap.exists) {
    return { ...DEFAULT_PLATFORM_SETTINGS };
  }
  const data = snap.data() as Partial<PlatformSettingsEntity>;
  return {
    platformName: data.platformName || DEFAULT_PLATFORM_SETTINGS.platformName,
    supportEmail: data.supportEmail || DEFAULT_PLATFORM_SETTINGS.supportEmail,
    tempPasswordTtlHours:
      typeof data.tempPasswordTtlHours === 'number'
        ? data.tempPasswordTtlHours
        : DEFAULT_PLATFORM_SETTINGS.tempPasswordTtlHours,
    activationLinkTtlHours:
      typeof data.activationLinkTtlHours === 'number'
        ? data.activationLinkTtlHours
        : DEFAULT_PLATFORM_SETTINGS.activationLinkTtlHours,
    allowPublicFideleSignup:
      typeof data.allowPublicFideleSignup === 'boolean'
        ? data.allowPublicFideleSignup
        : DEFAULT_PLATFORM_SETTINGS.allowPublicFideleSignup,
    requireCureAnnouncementApproval:
      typeof data.requireCureAnnouncementApproval === 'boolean'
        ? data.requireCureAnnouncementApproval
        : DEFAULT_PLATFORM_SETTINGS.requireCureAnnouncementApproval,
  };
}

export async function savePlatformSettings(settings: PlatformSettingsEntity): Promise<void> {
  const db = getAdminDb();
  await db
    .collection(COLLECTIONS.PLATFORM_SETTINGS)
    .doc('global')
    .set(stripUndefined({ ...settings }), { merge: true });
}
