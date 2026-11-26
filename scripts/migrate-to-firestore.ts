import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  formatFirestoreError,
  getAdminDb,
  verifyFirestoreConnection,
} from '../src/config/firebaseAdmin.js';
import { COLLECTIONS, stripUndefined } from '../src/repositories/collections.js';
import type { PlatformState } from '../src/modules/platform/platform.types.js';
import type { ParishRequestRecord } from '../src/modules/ecclesiastical/ecclesiastical.types.js';
import { DEFAULT_PLATFORM_SETTINGS } from '../src/repositories/system.repository.js';

interface MigrationCounter {
  collection: string;
  sourceCount: number;
  existingSkipped: number;
  toCreate: number;
}

interface PendingWrite {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

const MAX_BATCH_OPS = 400;

async function commitInBatches(writes: PendingWrite[]): Promise<number> {
  const db = getAdminDb();
  let committed = 0;

  for (let i = 0; i < writes.length; i += MAX_BATCH_OPS) {
    const chunk = writes.slice(i, i + MAX_BATCH_OPS);
    const batch = db.batch();
    for (const item of chunk) {
      const ref = db.collection(item.collection).doc(item.id);
      batch.set(ref, stripUndefined(item.data));
    }
    await batch.commit();
    committed += chunk.length;
  }

  return committed;
}

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(
    `[Migrate] Démarrage de la migration JSON -> Cloud Firestore (${isDryRun ? 'SIMULATION --dry-run' : 'ÉCRITURE RÉELLE'})`
  );

  const conn = await verifyFirestoreConnection();
  console.log(
    `[Migrate] Connexion Firestore OK : projectId=${conn.projectId}, databaseId=${conn.databaseId}`
  );

  const statePath = path.join(process.cwd(), 'src', 'data', 'platformState.json');
  const requestsPath = path.join(process.cwd(), 'src', 'data', 'parishRequests.json');

  if (!fs.existsSync(statePath)) {
    throw new Error(`Fichier source introuvable : ${statePath}`);
  }

  const rawState = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Partial<PlatformState>;
  const parishRequests = fs.existsSync(requestsPath)
    ? (JSON.parse(fs.readFileSync(requestsPath, 'utf-8')) as ParishRequestRecord[])
    : [];

  const db = getAdminDb();

  // Read existing Firestore docs once to ensure idempotency & non-overwrite of accounts/passwords/roles
  const [
    existingUsersSnap,
    existingParishesSnap,
    existingMembershipsSnap,
    existingRolesSnap,
    existingMessesSnap,
    existingAnnoncesSnap,
    existingIntentionsSnap,
    existingPaymentsSnap,
    existingEventsSnap,
    existingAuditSnap,
    existingNotifSnap,
    existingReqSnap,
    existingMetaSnap,
    existingSettingsSnap,
  ] = await Promise.all([
    db.collection(COLLECTIONS.USERS).get(),
    db.collection(COLLECTIONS.PARISHES).get(),
    db.collection(COLLECTIONS.PARISH_MEMBERSHIPS).get(),
    db.collection(COLLECTIONS.MEMBERSHIP_ROLES).get(),
    db.collection(COLLECTIONS.MESSES).get(),
    db.collection(COLLECTIONS.ANNONCES).get(),
    db.collection(COLLECTIONS.INTENTIONS).get(),
    db.collection(COLLECTIONS.PAYMENTS).get(),
    db.collection(COLLECTIONS.PAYMENT_EVENTS).get(),
    db.collection(COLLECTIONS.AUDIT_LOGS).get(),
    db.collection(COLLECTIONS.NOTIFICATIONS).get(),
    db.collection(COLLECTIONS.PARISH_REQUESTS).get(),
    db.collection(COLLECTIONS.SYSTEM_METADATA).doc('bootstrap').get(),
    db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc('global').get(),
  ]);

  const existingUserIds = new Set(existingUsersSnap.docs.map((d) => d.id));
  const existingUserEmails = new Set(
    existingUsersSnap.docs
      .map((d) => String((d.data() as { email?: string }).email || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const existingParishIds = new Set(existingParishesSnap.docs.map((d) => d.id));

  const sourceParishes = rawState.parishes ?? [];
  const validParishIds = new Set<string>([
    ...existingParishIds,
    ...sourceParishes.map((p) => p.id),
  ]);

  const warnings: string[] = [];
  const pendingWrites: PendingWrite[] = [];
  const counters: MigrationCounter[] = [];

  const queueCollection = <T extends { id: string }>(
    collection: string,
    items: T[],
    existingIds: Set<string>,
    validator?: (item: T) => boolean
  ) => {
    let existingSkipped = 0;
    let toCreate = 0;
    const seenIds = new Set<string>();

    for (const item of items) {
      if (!item?.id || seenIds.has(item.id)) {
        warnings.push(`[${collection}] Entrée ignorée (id manquant ou doublon) : ${item?.id}`);
        continue;
      }
      seenIds.add(item.id);
      if (validator && !validator(item)) continue;

      if (existingIds.has(item.id)) {
        existingSkipped += 1;
        continue;
      }

      pendingWrites.push({
        collection,
        id: item.id,
        data: { ...item } as unknown as Record<string, unknown>,
      });
      toCreate += 1;
    }

    counters.push({
      collection,
      sourceCount: items.length,
      existingSkipped,
      toCreate,
    });
  };

  // Users: check both ID and normalized email so existing accounts/passwords are NEVER overwritten
  const sourceUsers = rawState.users ?? [];
  {
    let existingSkipped = 0;
    let toCreate = 0;
    const seenEmails = new Set<string>();

    for (const user of sourceUsers) {
      const cleanEmail = String(user.email || '').trim().toLowerCase();
      if (!user.id || !cleanEmail) {
        warnings.push(`[users] Utilisateur ignoré (id ou email manquant).`);
        continue;
      }
      if (seenEmails.has(cleanEmail)) {
        warnings.push(`[users] Doublon d'email dans la source JSON ignoré : ${cleanEmail}`);
        continue;
      }
      seenEmails.add(cleanEmail);

      if (existingUserIds.has(user.id) || existingUserEmails.has(cleanEmail)) {
        existingSkipped += 1;
        continue;
      }

      pendingWrites.push({
        collection: COLLECTIONS.USERS,
        id: user.id,
        data: { ...user, email: cleanEmail } as unknown as Record<string, unknown>,
      });
      toCreate += 1;
    }

    counters.push({
      collection: COLLECTIONS.USERS,
      sourceCount: sourceUsers.length,
      existingSkipped,
      toCreate,
    });
  }

  queueCollection(COLLECTIONS.PARISHES, sourceParishes, existingParishIds);

  queueCollection(
    COLLECTIONS.PARISH_MEMBERSHIPS,
    rawState.memberships ?? [],
    new Set(existingMembershipsSnap.docs.map((d) => d.id)),
    (m) => {
      if (!validParishIds.has(m.parishId)) {
        warnings.push(`[parishMemberships] parishId introuvable pour ${m.id} (${m.parishId}).`);
      }
      return true;
    }
  );

  queueCollection(
    COLLECTIONS.MEMBERSHIP_ROLES,
    rawState.membershipRoles ?? [],
    new Set(existingRolesSnap.docs.map((d) => d.id)),
    (r) => {
      if (!validParishIds.has(r.parishId)) {
        warnings.push(`[membershipRoles] parishId introuvable pour ${r.id} (${r.parishId}).`);
      }
      return true;
    }
  );

  queueCollection(
    COLLECTIONS.MESSES,
    rawState.messes ?? [],
    new Set(existingMessesSnap.docs.map((d) => d.id)),
    (m) => {
      if (!validParishIds.has(m.parishId)) {
        warnings.push(`[messes] parishId introuvable pour ${m.id} (${m.parishId}).`);
      }
      return true;
    }
  );

  queueCollection(
    COLLECTIONS.ANNONCES,
    rawState.annonces ?? [],
    new Set(existingAnnoncesSnap.docs.map((d) => d.id)),
    (a) => {
      if (!validParishIds.has(a.parishId)) {
        warnings.push(`[annonces] parishId introuvable pour ${a.id} (${a.parishId}).`);
      }
      return true;
    }
  );

  queueCollection(
    COLLECTIONS.INTENTIONS,
    rawState.intentions ?? [],
    new Set(existingIntentionsSnap.docs.map((d) => d.id)),
    (i) => {
      if (!validParishIds.has(i.parishId)) {
        warnings.push(`[intentions] parishId introuvable pour ${i.id} (${i.parishId}).`);
      }
      return true;
    }
  );

  queueCollection(
    COLLECTIONS.PAYMENTS,
    rawState.payments ?? [],
    new Set(existingPaymentsSnap.docs.map((d) => d.id)),
    (p) => {
      if (!validParishIds.has(p.parishId)) {
        warnings.push(`[payments] parishId introuvable pour ${p.id} (${p.parishId}).`);
      }
      return true;
    }
  );

  queueCollection(
    COLLECTIONS.PAYMENT_EVENTS,
    rawState.paymentEvents ?? [],
    new Set(existingEventsSnap.docs.map((d) => d.id))
  );

  queueCollection(
    COLLECTIONS.AUDIT_LOGS,
    rawState.auditLogs ?? [],
    new Set(existingAuditSnap.docs.map((d) => d.id))
  );

  queueCollection(
    COLLECTIONS.NOTIFICATIONS,
    rawState.notifications ?? [],
    new Set(existingNotifSnap.docs.map((d) => d.id))
  );

  queueCollection(
    COLLECTIONS.PARISH_REQUESTS,
    parishRequests,
    new Set(existingReqSnap.docs.map((d) => d.id))
  );

  if (!existingSettingsSnap.exists) {
    pendingWrites.push({
      collection: COLLECTIONS.PLATFORM_SETTINGS,
      id: 'global',
      data: { ...(rawState.settings ?? DEFAULT_PLATFORM_SETTINGS) },
    });
  }

  const prevMeta = existingMetaSnap.exists
    ? (existingMetaSnap.data() as { superAdminClaimed?: boolean; version?: number })
    : {};
  const anyExistingSuperAdminHasHash = existingUsersSnap.docs.some((d) => {
    const u = d.data() as { isSuperAdmin?: boolean; passwordHash?: string | null };
    return Boolean(u.isSuperAdmin && u.passwordHash);
  });
  const anySourceSuperAdminHasHash = sourceUsers.some((u) =>
    Boolean(u.isSuperAdmin && u.passwordHash)
  );
  const superAdminClaimed = Boolean(
    prevMeta.superAdminClaimed ||
      rawState.superAdminClaimed ||
      anyExistingSuperAdminHasHash ||
      anySourceSuperAdminHasHash
  );

  const nowIso = new Date().toISOString();
  pendingWrites.push({
    collection: COLLECTIONS.SYSTEM_METADATA,
    id: 'bootstrap',
    data: {
      version: rawState.version ?? prevMeta.version ?? 1,
      superAdminClaimed,
      migratedAt: nowIso,
      source: 'platformState.json + parishRequests.json',
    },
  });

  console.table(counters);
  if (warnings.length > 0) {
    console.warn('[Migrate] Avertissements d’intégrité :');
    for (const w of warnings) console.warn('  -', w);
  }

  if (isDryRun) {
    console.log(
      `[Migrate][DRY-RUN] Aucune écriture effectuée. ${pendingWrites.length} opération(s) préparée(s).`
    );
    return;
  }

  const committedCount = await commitInBatches(pendingWrites);
  console.log(`[Migrate] Terminé avec succès : ${committedCount} document(s) écrit(s) dans Firestore.`);
}

run().catch((err) => {
  console.error(formatFirestoreError('migrate-to-firestore', err));
  process.exit(1);
});
