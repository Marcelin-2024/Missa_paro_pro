import assert from 'assert';
import crypto from 'crypto';
import http from 'http';
import { spawnSync } from 'child_process';
import { getApps } from 'firebase-admin/app';
import {
  classifyFirestoreError,
  getAdminApp,
  getAdminDb,
  verifyFirestoreConnection,
} from '../src/config/firebaseAdmin.js';
import { FirestoreSessionStore } from '../src/modules/auth/firestoreSessionStore.js';

process.env.MISSA_NO_LISTEN = '1';
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
}

function sendHttp(
  baseUrl: string,
  method: 'GET' | 'HEAD',
  urlPath: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(urlPath, baseUrl);
    const req = http.request(
      target,
      { method, headers: { Accept: 'application/json,text/html' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function runSubprocessEnvCheck(envOverrides: Record<string, string>, code: string): {
  ok: boolean;
  output: string;
} {
  const res = spawnSync('npx', ['tsx', '-e', code], {
    env: { ...process.env, ...envOverrides },
    encoding: 'utf-8',
  });
  const output = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
  return { ok: res.status === 0, output };
}

async function testAdminValidationAndSingleton() {
  console.log('1-3) Validation project_id, client_email, private_key & singleton Firebase Admin...');

  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  // Missing FIREBASE_SERVICE_ACCOUNT in production
  const missingRes = runSubprocessEnvCheck(
    { NODE_ENV: 'production', FIREBASE_SERVICE_ACCOUNT: '' },
    "import { getAdminApp } from './src/config/firebaseAdmin'; getAdminApp();"
  );
  assert.strictEqual(missingRes.ok, false);
  assert.ok(missingRes.output.includes('FIREBASE_SERVICE_ACCOUNT'), missingRes.output);

  // Malformed JSON
  const badJsonRes = runSubprocessEnvCheck(
    { NODE_ENV: 'production', FIREBASE_SERVICE_ACCOUNT: '{invalid-json' },
    "import { getAdminApp } from './src/config/firebaseAdmin'; getAdminApp();"
  );
  assert.strictEqual(badJsonRes.ok, false);
  assert.ok(badJsonRes.output.includes('JSON mal formé'), badJsonRes.output);

  // Wrong project_id rejected
  const wrongProjectRes = runSubprocessEnvCheck(
    {
      NODE_ENV: 'production',
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
        project_id: 'wrong-project-id',
        client_email: 'sa@wrong-project-id.iam.gserviceaccount.com',
        private_key: privateKey.replace(/\n/g, '\\n'),
      }),
    },
    "import { getAdminApp } from './src/config/firebaseAdmin'; getAdminApp();"
  );
  assert.strictEqual(wrongProjectRes.ok, false);
  assert.ok(wrongProjectRes.output.includes('missaparo-70dfd'), wrongProjectRes.output);

  // Missing/invalid client_email rejected
  const badEmailRes = runSubprocessEnvCheck(
    {
      NODE_ENV: 'production',
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
        project_id: 'missaparo-70dfd',
        client_email: 'not-an-email',
        private_key: privateKey.replace(/\n/g, '\\n'),
      }),
    },
    "import { getAdminApp } from './src/config/firebaseAdmin'; getAdminApp();"
  );
  assert.strictEqual(badEmailRes.ok, false);
  assert.ok(badEmailRes.output.includes('client_email'), badEmailRes.output);

  // Valid missaparo-70dfd JSON -> singleton app & single Firestore instance
  const validRes = runSubprocessEnvCheck(
    {
      NODE_ENV: 'production',
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
        type: 'service_account',
        project_id: 'missaparo-70dfd',
        client_email: 'firebase-adminsdk-fbsvc@missaparo-70dfd.iam.gserviceaccount.com',
        private_key: privateKey.replace(/\n/g, '\\n'),
      }),
    },
    "import { getApps } from 'firebase-admin/app'; import { getAdminApp, getAdminDb } from './src/config/firebaseAdmin'; const a1 = getAdminApp(); const a2 = getAdminApp(); const d1 = getAdminDb(); const d2 = getAdminDb(); if (a1 !== a2 || d1 !== d2 || getApps().length !== 1) process.exit(1); console.log(JSON.stringify({ apps: getApps().length, projectId: a1.options.projectId }));"
  );
  assert.strictEqual(validRes.ok, true, validRes.output);
  assert.ok(validRes.output.includes('"apps":1'), validRes.output);
  assert.ok(validRes.output.includes('"projectId":"missaparo-70dfd"'), validRes.output);

  // Error classification coverage
  assert.strictEqual(classifyFirestoreError({ code: 7, message: 'PERMISSION_DENIED' }).category, 'PERMISSION_DENIED');
  assert.strictEqual(classifyFirestoreError({ code: 16, message: 'UNAUTHENTICATED' }).category, 'UNAUTHENTICATED');
  assert.strictEqual(classifyFirestoreError({ code: 5, message: 'NOT_FOUND' }).category, 'NOT_FOUND');
  assert.strictEqual(classifyFirestoreError({ code: 14, message: 'UNAVAILABLE' }).category, 'UNAVAILABLE');
  assert.strictEqual(classifyFirestoreError({ code: 4, message: 'DEADLINE_EXCEEDED' }).category, 'DEADLINE_EXCEEDED');

  console.log('   ✔ Validations credentials, project_id, client_email, erreurs & singleton OK.');
}

async function testHealthRoutesAndFirestoreCrud() {
  const { createApp } = await import('../server.js');

  // Spy on FirestoreSessionStore.prototype.set to guarantee 0 session writes on /health, HEAD /, GET /
  let sessionWrites = 0;
  const origSet = FirestoreSessionStore.prototype.set;
  FirestoreSessionStore.prototype.set = function (sid, sess, cb) {
    sessionWrites += 1;
    return origSet.call(this, sid, sess, cb);
  };

  const app = createApp();
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    console.log('9-10) Vérification GET /health, HEAD /health, HEAD / et GET / sans écriture Firestore...');
    const appsBefore = getApps().length;

    const getHealth = await sendHttp(baseUrl, 'GET', '/health');
    assert.strictEqual(getHealth.status, 200);
    assert.strictEqual(JSON.parse(getHealth.body).status, 'ok');

    const headHealth = await sendHttp(baseUrl, 'HEAD', '/health');
    assert.strictEqual(headHealth.status, 200);

    const headRoot = await sendHttp(baseUrl, 'HEAD', '/');
    assert.strictEqual(headRoot.status, 200);

    // Neither /health nor HEAD / should even initialize Firebase Admin if not yet initialized
    assert.strictEqual(getApps().length, appsBefore);
    assert.strictEqual(sessionWrites, 0, 'Aucune écriture de session attendue sur /health ou HEAD /');

    console.log('4-8) Vérification disponibilité Firestore & cycle lecture/écriture/suppression (_system_healthchecks)...');
    const conn = await verifyFirestoreConnection();
    assert.strictEqual(conn.ok, true);
    assert.strictEqual(getApps().length, 1);
    assert.strictEqual(getAdminApp(), getAdminApp());

    const getReady = await sendHttp(baseUrl, 'GET', '/health/ready');
    assert.strictEqual(getReady.status, 200, getReady.body);
    assert.strictEqual(JSON.parse(getReady.body).status, 'ready');

    const getRoot = await sendHttp(baseUrl, 'GET', '/');
    assert.strictEqual(getRoot.status, 200);
    assert.strictEqual(sessionWrites, 0, 'GET / anonyme ne doit déclencher aucune écriture de session Firestore');

    // Dedicated _system_healthchecks collection write -> read -> delete
    const db = getAdminDb();
    const docId = `health-${crypto.randomUUID().slice(0, 8)}`;
    const ref = db.collection('_system_healthchecks').doc(docId);
    const payload = { ok: true, createdAt: new Date().toISOString(), source: 'test-health-and-admin' };

    await ref.set(payload);
    const snap = await ref.get();
    assert.strictEqual(snap.exists, true);
    assert.strictEqual((snap.data() as { ok: boolean }).ok, true);

    await ref.delete();
    const deletedSnap = await ref.get();
    assert.strictEqual(deletedSnap.exists, false);

    console.log('   ✔ Routes santé sans écriture + CRUD _system_healthchecks nettoyé OK.');
  } finally {
    FirestoreSessionStore.prototype.set = origSet;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('11) Vérification HTTP 503 sur GET /health/ready si Firestore inaccessible...');
  const unavailableRes = spawnSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `
      import http from 'http';
      import assert from 'assert';
      import { createApp } from './dist/server.js';
      const app = createApp();
      const s = app.listen(0, '127.0.0.1', () => {
        const port = s.address().port;
        http.get('http://127.0.0.1:' + port + '/health/ready', (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            assert.strictEqual(res.statusCode, 503);
            assert.ok(!body.includes('private_key'));
            console.log('PASS_503:', res.statusCode, body);
            s.close(() => process.exit(0));
          });
        });
      });
      `,
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        FIREBASE_SERVICE_ACCOUNT: '',
        MISSA_NO_LISTEN: '1',
        SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      },
      encoding: 'utf-8',
    }
  );
  const unavailableOut = `${unavailableRes.stdout || ''}\n${unavailableRes.stderr || ''}`.trim();
  assert.strictEqual(unavailableRes.status, 0, unavailableOut);
  assert.ok(unavailableOut.includes('PASS_503: 503'), unavailableOut);
  console.log('   ✔ HTTP 503 confirmé sans fuite de secrets.');
}

async function main() {
  await testAdminValidationAndSingleton();
  await testHealthRoutesAndFirestoreCrud();
  console.log('[Tests Health & Admin] Tous les 11 contrôles ont réussi.');
}

main().catch((err) => {
  console.error('[Tests Health & Admin] ÉCHEC :', err);
  process.exit(1);
});
