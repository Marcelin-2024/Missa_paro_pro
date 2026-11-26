import 'dotenv/config';
import {
  formatFirestoreError,
  getAdminDb,
  verifyFirestoreConnection,
} from '../src/config/firebaseAdmin.js';
import { buildDemoSeedState } from '../src/modules/platform/platform.repository.js';
import { COLLECTIONS, stripUndefined } from '../src/repositories/collections.js';

const MAX_BATCH_OPS = 400;

async function run() {
  const forceDemo = process.argv.includes('--force-demo');
  if (process.env.NODE_ENV === 'production' && !forceDemo) {
    console.error(
      '[SeedDemo] Refus d’exécuter le seed de démonstration en NODE_ENV=production sans --force-demo.'
    );
    process.exit(1);
  }

  const conn = await verifyFirestoreConnection();
  console.log(
    `[SeedDemo] Connexion Firestore OK : projectId=${conn.projectId}, databaseId=${conn.databaseId}`
  );

  const db = getAdminDb();
  const seed = buildDemoSeedState();

  const existingUsersSnap = await db.collection(COLLECTIONS.USERS).get();
  const existingUserIds = new Set(existingUsersSnap.docs.map((d) => d.id));
  const existingUserEmails = new Set(
    existingUsersSnap.docs
      .map((d) => String((d.data() as { email?: string }).email || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const ops: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
  let skipped = 0;

  for (const user of seed.users) {
    const cleanEmail = user.email.trim().toLowerCase();
    if (existingUserIds.has(user.id) || existingUserEmails.has(cleanEmail)) {
      skipped += 1;
      continue;
    }
    ops.push({
      collection: COLLECTIONS.USERS,
      id: user.id,
      data: { ...user, email: cleanEmail },
    });
  }

  const pairs: Array<[string, Array<{ id: string }>]> = [
    [COLLECTIONS.PARISHES, seed.parishes],
    [COLLECTIONS.PARISH_MEMBERSHIPS, seed.memberships],
    [COLLECTIONS.MEMBERSHIP_ROLES, seed.membershipRoles],
    [COLLECTIONS.MESSES, seed.messes],
    [COLLECTIONS.ANNONCES, seed.annonces],
    [COLLECTIONS.INTENTIONS, seed.intentions],
    [COLLECTIONS.AUDIT_LOGS, seed.auditLogs],
    [COLLECTIONS.NOTIFICATIONS, seed.notifications],
  ];

  for (const [collection, docs] of pairs) {
    const snap = await db.collection(collection).get();
    const existingIds = new Set(snap.docs.map((d) => d.id));
    for (const doc of docs) {
      if (existingIds.has(doc.id)) {
        skipped += 1;
        continue;
      }
      ops.push({
        collection,
        id: doc.id,
        data: { ...doc } as unknown as Record<string, unknown>,
      });
    }
  }

  const settingsSnap = await db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc('global').get();
  if (!settingsSnap.exists) {
    ops.push({
      collection: COLLECTIONS.PLATFORM_SETTINGS,
      id: 'global',
      data: { ...seed.settings },
    });
  }

  const metaSnap = await db.collection(COLLECTIONS.SYSTEM_METADATA).doc('bootstrap').get();
  const prevMeta = metaSnap.exists ? (metaSnap.data() as { superAdminClaimed?: boolean }) : {};
  ops.push({
    collection: COLLECTIONS.SYSTEM_METADATA,
    id: 'bootstrap',
    data: {
      version: seed.version,
      superAdminClaimed: Boolean(prevMeta.superAdminClaimed || seed.superAdminClaimed),
      seededAt: new Date().toISOString(),
    },
  });

  for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
    const chunk = ops.slice(i, i + MAX_BATCH_OPS);
    const batch = db.batch();
    for (const item of chunk) {
      batch.set(db.collection(item.collection).doc(item.id), stripUndefined(item.data), {
        merge: item.collection === COLLECTIONS.SYSTEM_METADATA,
      });
    }
    await batch.commit();
  }

  console.log(
    `[SeedDemo] Terminé : ${ops.length} document(s) créé(s)/mis à jour, ${skipped} document(s) existant(s) préservé(s).`
  );
}

run().catch((err) => {
  console.error(formatFirestoreError('seed-demo', err));
  process.exit(1);
});
