import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { execSync } from 'child_process';
import {
  getAdminDb,
  isFirestorePermissionDenied,
  verifyFirestoreConnection,
} from '../src/config/firebaseAdmin.js';
import { COLLECTIONS } from '../src/repositories/collections.js';
import { cleanupExpiredSessions } from '../src/modules/auth/firestoreSessionStore.js';
import { uploadAnnonceImage } from '../src/utils/storageHelper.js';

process.env.MISSA_NO_LISTEN = '1';
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
}

function requestJson(
  baseUrl: string,
  method: string,
  urlPath: string,
  body?: unknown,
  cookie?: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; json: any }> {
  return new Promise((resolve, reject) => {
    const target = new URL(urlPath, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      target,
      {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {
            // non-json response
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, body: text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runStaticAndOfflineChecks() {
  console.log('1) Vérifications statiques & offline...');

  // No remaining JSON/inMemory runtime imports in src/ or server.ts
  const srcFiles = execSync(
    'grep -rnE "inMemoryDb|getPlatformState|savePlatformState|readParishRequests|\\.session-secret" src server.ts || true',
    { encoding: 'utf-8' }
  ).trim();
  assert.strictEqual(srcFiles, '', `Références obsolètes détectées:\n${srcFiles}`);

  // Production SESSION_SECRET enforcement
  let prodFailedAsExpected = false;
  try {
    execSync(
      'NODE_ENV=production SESSION_SECRET=too-short MISSA_NO_LISTEN=1 npx tsx -e "import { createApp } from \'./server.js\'; createApp();"',
      { stdio: 'pipe' }
    );
  } catch {
    prodFailedAsExpected = true;
  }
  assert.strictEqual(
    prodFailedAsExpected,
    true,
    'createApp() doit refuser de démarrer en production si SESSION_SECRET < 32 caractères.'
  );

  // Storage helper rejects oversized inline fallback
  const bigBuffer = Buffer.alloc(600_000, 'a');
  const uploadFail = await uploadAnnonceImage(
    {
      fieldname: 'image_annonce',
      originalname: 'huge.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: bigBuffer.length,
      buffer: bigBuffer,
    } as Express.Multer.File,
    'parish_test',
    'ann_test'
  );
  // Note: if Cloud Storage bucket isn't writable, helper falls back to inline size guard
  if (!uploadFail.ok) {
    assert.strictEqual(uploadFail.status, 400);
  }

  // Backup files must exist
  assert.ok(fs.existsSync(path.join(process.cwd(), 'backups/pre-migration/platformState.backup.json')));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'backups/pre-migration/parishRequests.backup.json')));
  console.log('   ✔ Vérifications statiques & offline réussies.');
}

async function runLiveFirestoreE2E() {
  console.log('2) Test de connectivité Cloud Firestore...');
  try {
    const conn = await verifyFirestoreConnection();
    console.log(`   ✔ Connecté à ${conn.projectId} (${conn.databaseId})`);
  } catch (err) {
    if (isFirestorePermissionDenied(err)) {
      console.warn(
        '   ⚠ Ignoré (PERMISSION_DENIED) : le compte de service n’a pas encore roles/datastore.user sur ce projet.'
      );
      return { skippedDueToIam: true };
    }
    throw err;
  }

  const { createApp } = await import('../server.js');
  const db = getAdminDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const testEmail = `e2e.test.${suffix}@missaparo.ci`;
  const testPassword = `Pass!${suffix}99`;
  const createdDocPaths: Array<[string, string]> = [];

  // Start Server Instance 1
  const app1 = createApp();
  const server1 = await new Promise<http.Server>((resolve) => {
    const s = app1.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port1 = (server1.address() as { port: number }).port;
  const baseUrl1 = `http://127.0.0.1:${port1}`;

  let sessionCookie = '';
  let trackingRef = '';
  let intentionId = '';
  let createdUserId = '';

  try {
    console.log('3) Test RBAC, isolation multi-paroisses, inscription & session persistante (Instance 1)...');

    // Unauthenticated GET /api/messes without parishId -> 400
    const noParishMesses = await requestJson(baseUrl1, 'GET', '/api/messes');
    assert.strictEqual(noParishMesses.status, 400);

    // Unauthenticated GET /api/ecclesiastical/parish-requests -> 401
    const unauthReq = await requestJson(baseUrl1, 'GET', '/api/ecclesiastical/parish-requests');
    assert.strictEqual(unauthReq.status, 401);

    // Register fidèle account
    const reg = await requestJson(baseUrl1, 'POST', '/api/fideles', {
      nom_complet: `Fidèle Test ${suffix}`,
      email: testEmail,
      telephone: '+2250707070707',
      password: testPassword,
      provinceId: 'province_abidjan',
      dioceseId: 'diocese_abidjan',
      parishId: 'paroisse_cathedrale_saint_paul_plateau',
    });
    assert.strictEqual(reg.status, 201, `Inscription fidèle échouée: ${reg.body}`);
    createdUserId = reg.json.user.id;
    createdDocPaths.push([COLLECTIONS.USERS, createdUserId]);

    // Login & capture session cookie
    const login = await requestJson(baseUrl1, 'POST', '/api/login', {
      email: testEmail,
      password: testPassword,
    });
    assert.strictEqual(login.status, 200, `Login échoué: ${login.body}`);
    const setCookieHeader = login.headers['set-cookie'];
    assert.ok(setCookieHeader && setCookieHeader.length > 0, 'Cookie de session non émis');
    sessionCookie = setCookieHeader[0].split(';')[0];

    // Submit public intention
    const submitInt = await requestJson(
      baseUrl1,
      'POST',
      '/api/intentions/public',
      {
        provinceId: 'province_abidjan',
        dioceseId: 'diocese_abidjan',
        parishId: 'paroisse_cathedrale_saint_paul_plateau',
        requesterName: `Fidèle Test ${suffix}`,
        requesterPhone: '+2250707070707',
        requesterEmail: testEmail,
        intentionType: 'ACTION_GRACE',
        objet: 'Action de grâce E2E',
        details: 'Test de persistance Firestore E2E.',
      },
      sessionCookie
    );
    assert.strictEqual(submitInt.status, 201, `Soumission intention échouée: ${submitInt.body}`);
    trackingRef = submitInt.json.trackingRef;
    intentionId = submitInt.json.intentionId;
    createdDocPaths.push([COLLECTIONS.INTENTIONS, intentionId]);

    // First simulated payment -> 201 SUCCESS
    const pay1 = await requestJson(baseUrl1, 'POST', '/api/payments/simulate', {
      intentionId,
      provider: 'WAVE',
      faithfulPhone: '+2250707070707',
      scenario: 'SUCCESS',
    });
    assert.strictEqual(pay1.status, 201, `Paiement 1 échoué: ${pay1.body}`);
    createdDocPaths.push([COLLECTIONS.PAYMENTS, pay1.json.payment.id]);
    for (const evt of pay1.json.events || []) {
      createdDocPaths.push([COLLECTIONS.PAYMENT_EVENTS, evt.id]);
    }

    // Second simulated payment on same intention -> 409 Conflict (transaction lock)
    const pay2 = await requestJson(baseUrl1, 'POST', '/api/payments/simulate', {
      intentionId,
      provider: 'ORANGE_MONEY',
      faithfulPhone: '+2250707070707',
      scenario: 'SUCCESS',
    });
    assert.strictEqual(pay2.status, 409, `Double paiement non bloqué: ${pay2.status} ${pay2.body}`);
  } finally {
    await new Promise<void>((resolve) => server1.close(() => resolve()));
  }

  // Start Server Instance 2 (simulating Cloud Run restart / new container instance)
  console.log('4) Test de persistance après redémarrage complet (Instance 2)...');
  const app2 = createApp();
  const server2 = await new Promise<http.Server>((resolve) => {
    const s = app2.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port2 = (server2.address() as { port: number }).port;
  const baseUrl2 = `http://127.0.0.1:${port2}`;

  try {
    // Session cookie from Instance 1 MUST work on Instance 2!
    const statusAfterRestart = await requestJson(
      baseUrl2,
      'GET',
      '/api/auth/session-status',
      undefined,
      sessionCookie
    );
    assert.strictEqual(statusAfterRestart.status, 200);
    assert.strictEqual(
      statusAfterRestart.json.authenticated,
      true,
      'La session Firestore aurait dû survivre au redémarrage du serveur !'
    );

    // Intention & payment MUST still be retrievable on Instance 2
    const tracked = await requestJson(baseUrl2, 'GET', `/api/intentions/suivi/${trackingRef}`);
    assert.strictEqual(tracked.status, 200);
    assert.strictEqual(tracked.json.tracking.trackingRef, trackingRef);
    assert.strictEqual(tracked.json.tracking.payment.status, 'SUCCESS');

    // Login with same password MUST still succeed on Instance 2
    const relogin = await requestJson(baseUrl2, 'POST', '/api/login', {
      email: testEmail,
      password: testPassword,
    });
    assert.strictEqual(relogin.status, 200);

    // Test expired session cleanup
    const expiredSid = `expired-e2e-${suffix}`;
    await db.collection(COLLECTIONS.SESSIONS).doc(expiredSid).set({
      sid: expiredSid,
      data: { uid: 'nobody' },
      expiresAtMs: Date.now() - 60_000,
      updatedAt: new Date().toISOString(),
    });
    const cleaned = await cleanupExpiredSessions();
    assert.ok(cleaned >= 1, 'cleanupExpiredSessions aurait dû supprimer la session expirée.');
    const expiredCheck = await db.collection(COLLECTIONS.SESSIONS).doc(expiredSid).get();
    assert.strictEqual(expiredCheck.exists, false);

    console.log('   ✔ Persistance multi-instance, sessions Firestore & verrou paiement validés.');
  } finally {
    await new Promise<void>((resolve) => server2.close(() => resolve()));

    // Clean up test documents
    for (const [col, id] of createdDocPaths) {
      await db.collection(col).doc(id).delete().catch(() => undefined);
    }
    const notifSnap = await db
      .collection(COLLECTIONS.NOTIFICATIONS)
      .where('trackingRef', '==', trackingRef)
      .get()
      .catch(() => null);
    if (notifSnap) {
      for (const d of notifSnap.docs) {
        await d.ref.delete().catch(() => undefined);
      }
    }
    const auditSnap = await db
      .collection(COLLECTIONS.AUDIT_LOGS)
      .where('actorEmail', '==', testEmail)
      .get()
      .catch(() => null);
    if (auditSnap) {
      for (const d of auditSnap.docs) {
        await d.ref.delete().catch(() => undefined);
      }
    }
  }

  return { skippedDueToIam: false };
}

async function main() {
  await runStaticAndOfflineChecks();
  const res = await runLiveFirestoreE2E();
  if (res.skippedDueToIam) {
    console.log('[Tests] Suite statique/offline OK ; tests live en attente du rôle IAM Firestore.');
    return;
  }
  console.log('[Tests] Tous les tests statiques et E2E Cloud Firestore ont réussi.');
}

main().catch((err) => {
  console.error('[Tests] ÉCHEC :', err);
  process.exit(1);
});
