import crypto from 'crypto';
import { getAdminDb } from '../config/firebaseAdmin.js';
import { COLLECTIONS, sanitizeDocId, stripUndefined } from './collections.js';

export interface ReviewRecord {
  id: string;
  userId: string | null;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface ContactRecord {
  id: string;
  message: string;
  createdAt: string;
}

export interface PushTokenRecord {
  id: string;
  userId: string;
  token: string;
  updatedAt: string;
}

interface LoginAttemptDoc {
  key: string;
  count: number;
  lockedUntilMs: number;
  updatedAt: string;
}

export async function saveReviewRepo(
  userId: string | undefined,
  note: number,
  commentaire: string
): Promise<ReviewRecord> {
  const rec: ReviewRecord = {
    id: `rev-${crypto.randomUUID().slice(0, 12)}`,
    userId: userId ?? null,
    rating: Number.isFinite(note) ? Math.max(1, Math.min(5, Math.round(note))) : 5,
    comment: String(commentaire || '').trim().slice(0, 2000),
    createdAt: new Date().toISOString(),
  };
  await getAdminDb().collection(COLLECTIONS.REVIEWS).doc(rec.id).set(stripUndefined({ ...rec }));
  return rec;
}

export async function saveContactRepo(message: string): Promise<ContactRecord> {
  const rec: ContactRecord = {
    id: `cnt-${crypto.randomUUID().slice(0, 12)}`,
    message: String(message || '').trim().slice(0, 4000),
    createdAt: new Date().toISOString(),
  };
  await getAdminDb().collection(COLLECTIONS.CONTACTS).doc(rec.id).set(stripUndefined({ ...rec }));
  return rec;
}

export async function savePushTokenRepo(userId: string, token: string): Promise<PushTokenRecord> {
  const safeId = sanitizeDocId(userId || 'anonymous') || 'anonymous';
  const rec: PushTokenRecord = {
    id: safeId,
    userId: userId || 'anonymous',
    token: String(token || 'registered').trim().slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
  await getAdminDb().collection(COLLECTIONS.PUSH_TOKENS).doc(safeId).set(stripUndefined({ ...rec }));
  return rec;
}

function attemptDocRef(key: string) {
  const digest = crypto.createHash('sha256').update(key).digest('hex').slice(0, 40);
  return getAdminDb().collection(COLLECTIONS.LOGIN_ATTEMPTS).doc(digest);
}

export async function checkLoginRateLimitRepo(
  key: string
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const snap = await attemptDocRef(key).get();
  if (!snap.exists) return { allowed: true };
  const rec = snap.data() as LoginAttemptDoc;
  if (rec.lockedUntilMs > Date.now()) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((rec.lockedUntilMs - Date.now()) / 1000),
    };
  }
  return { allowed: true };
}

export async function recordLoginFailureRepo(key: string): Promise<void> {
  const ref = attemptDocRef(key);
  await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists
      ? (snap.data() as LoginAttemptDoc)
      : { key, count: 0, lockedUntilMs: 0, updatedAt: '' };
    const nextCount = prev.count + 1;
    const lockedUntilMs = nextCount >= 5 ? Date.now() + 5 * 60 * 1000 : 0;
    tx.set(ref, {
      key,
      count: nextCount,
      lockedUntilMs,
      updatedAt: new Date().toISOString(),
    } satisfies LoginAttemptDoc);
  });
}

export async function clearLoginFailuresRepo(key: string): Promise<void> {
  await attemptDocRef(key).delete().catch(() => undefined);
}
