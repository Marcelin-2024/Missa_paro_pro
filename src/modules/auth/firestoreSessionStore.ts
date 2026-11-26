import session, { type SessionData } from 'express-session';
import { getAdminDb } from '../../config/firebaseAdmin.js';
import { COLLECTIONS } from '../../repositories/collections.js';

interface FirestoreSessionDoc {
  sid: string;
  data: Record<string, unknown>;
  expiresAtMs: number;
  updatedAt: string;
}

function resolveExpiryMs(sess: SessionData, defaultTtlMs: number): number {
  if (sess.cookie?.expires) {
    const exp = new Date(sess.cookie.expires).getTime();
    if (Number.isFinite(exp) && exp > Date.now()) {
      return exp;
    }
  }
  if (typeof sess.cookie?.maxAge === 'number' && sess.cookie.maxAge > 0) {
    return Date.now() + sess.cookie.maxAge;
  }
  return Date.now() + defaultTtlMs;
}

export class FirestoreSessionStore extends session.Store {
  private readonly ttlMs: number;

  constructor(options?: { ttlMs?: number }) {
    super();
    this.ttlMs = options?.ttlMs ?? 1000 * 60 * 60 * 12;
  }

  private docRef(sid: string) {
    const safeSid = encodeURIComponent(sid).slice(0, 250);
    return getAdminDb().collection(COLLECTIONS.SESSIONS).doc(safeSid);
  }

  override get(
    sid: string,
    callback: (err?: unknown, session?: SessionData | null) => void
  ): void {
    void (async () => {
      try {
        const snap = await this.docRef(sid).get();
        if (!snap.exists) {
          callback(null, null);
          return;
        }
        const doc = snap.data() as FirestoreSessionDoc;
        if (!doc || typeof doc.expiresAtMs !== 'number' || doc.expiresAtMs <= Date.now()) {
          await this.docRef(sid).delete().catch(() => undefined);
          callback(null, null);
          return;
        }
        callback(null, doc.data as unknown as SessionData);
      } catch (err) {
        callback(err);
      }
    })();
  }

  override set(
    sid: string,
    sess: SessionData,
    callback?: (err?: unknown) => void
  ): void {
    void (async () => {
      try {
        const plainData = JSON.parse(JSON.stringify(sess)) as Record<string, unknown>;
        const payload: FirestoreSessionDoc = {
          sid,
          data: plainData,
          expiresAtMs: resolveExpiryMs(sess, this.ttlMs),
          updatedAt: new Date().toISOString(),
        };
        await this.docRef(sid).set(payload);
        callback?.(null);
      } catch (err) {
        callback?.(err);
      }
    })();
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    void (async () => {
      try {
        await this.docRef(sid).delete();
        callback?.(null);
      } catch (err) {
        callback?.(err);
      }
    })();
  }

  override touch(
    sid: string,
    sess: SessionData,
    callback?: (err?: unknown) => void
  ): void {
    void (async () => {
      try {
        const expiresAtMs = resolveExpiryMs(sess, this.ttlMs);
        await this.docRef(sid).set(
          {
            sid,
            data: JSON.parse(JSON.stringify(sess)) as Record<string, unknown>,
            expiresAtMs,
            updatedAt: new Date().toISOString(),
          } satisfies FirestoreSessionDoc,
          { merge: true }
        );
        callback?.(null);
      } catch (err) {
        callback?.(err);
      }
    })();
  }
}

export async function cleanupExpiredSessions(limit = 200): Promise<number> {
  const db = getAdminDb();
  const snap = await db
    .collection(COLLECTIONS.SESSIONS)
    .where('expiresAtMs', '<=', Date.now())
    .limit(limit)
    .get();

  if (snap.empty) return 0;

  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return snap.size;
}

export function startSessionCleanupTimer(intervalMs = 30 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    void cleanupExpiredSessions().catch((err) => {
      console.error('[SessionCleanup] Échec du nettoyage des sessions expirées :', err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
