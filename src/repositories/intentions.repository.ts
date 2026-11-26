import { getAdminDb } from '../config/firebaseAdmin.js';
import type { IntentionEntity } from '../modules/platform/platform.types.js';
import { COLLECTIONS, stripUndefined } from './collections.js';

function col() {
  return getAdminDb().collection(COLLECTIONS.INTENTIONS);
}

export async function listIntentionsByParishRepo(parishId: string): Promise<IntentionEntity[]> {
  const snap = await col().where('parishId', '==', parishId).get();
  return snap.docs
    .map((d) => d.data() as IntentionEntity)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function listIntentionsByRequesterRepo(userId: string): Promise<IntentionEntity[]> {
  const snap = await col().where('requesterUserId', '==', userId).get();
  return snap.docs
    .map((d) => d.data() as IntentionEntity)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function listValidatedPublicIntentionsRepo(
  parishId?: string
): Promise<IntentionEntity[]> {
  const snap = parishId
    ? await col().where('parishId', '==', parishId).get()
    : await col().where('status', 'in', ['ACCEPTED', 'SCHEDULED']).get();

  return snap.docs
    .map((d) => d.data() as IntentionEntity)
    .filter((item) => item.status === 'ACCEPTED' || item.status === 'SCHEDULED')
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function countAllIntentionsRepo(): Promise<number> {
  const agg = await col().count().get();
  return agg.data().count;
}

export async function countIntentionsByParishRepo(parishId: string): Promise<number> {
  const agg = await col().where('parishId', '==', parishId).count().get();
  return agg.data().count;
}

export async function findIntentionByIdRepo(id: string): Promise<IntentionEntity | null> {
  if (!id) return null;
  const snap = await col().doc(id).get();
  return snap.exists ? (snap.data() as IntentionEntity) : null;
}

export async function findIntentionByTrackingRefRepo(
  trackingRef: string
): Promise<IntentionEntity | null> {
  const cleanRef = String(trackingRef || '').trim().toUpperCase();
  if (!cleanRef) return null;
  const snap = await col().where('trackingRef', '==', cleanRef).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as IntentionEntity);
}

export async function saveIntentionRepo(intention: IntentionEntity): Promise<void> {
  await col().doc(intention.id).set(stripUndefined({ ...intention }));
}
