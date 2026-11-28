import fs from 'fs';
import path from 'path';
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
}

interface RawServiceAccountJson extends ServiceAccount {
  project_id?: string;
  private_key?: string;
  client_email?: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;
let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;

function parseServiceAccountFromEnv(): RawServiceAccountJson {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) {
    throw new Error(
      'Variable d’environnement FIREBASE_SERVICE_ACCOUNT manquante ou vide : fournissez le JSON du compte de service Firebase Admin.'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`FIREBASE_SERVICE_ACCOUNT invalide : JSON mal formé (${detail}).`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT invalide : un objet JSON est attendu.');
  }

  const serviceAccount = { ...(parsed as RawServiceAccountJson) };
  if (typeof serviceAccount.private_key === 'string' && serviceAccount.private_key.length > 0) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  if (typeof serviceAccount.privateKey === 'string' && serviceAccount.privateKey.length > 0) {
    serviceAccount.privateKey = serviceAccount.privateKey.replace(/\\n/g, '\n');
  }

  return serviceAccount;
}

export function getFirebaseConfig(serviceAccount?: RawServiceAccountJson): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  let fileCfg: Partial<FirebaseAppletConfig> = {};

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileCfg = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
  }

  const projectId = (
    process.env.FIREBASE_PROJECT_ID ||
    serviceAccount?.project_id ||
    serviceAccount?.projectId ||
    fileCfg.projectId ||
    ''
  ).trim();
  const matchesFileProject = Boolean(
    fileCfg.projectId && projectId === fileCfg.projectId.trim()
  );
  const firestoreDatabaseId = (
    process.env.FIRESTORE_DATABASE_ID ||
    (matchesFileProject ? fileCfg.firestoreDatabaseId : undefined) ||
    '(default)'
  ).trim();
  const storageBucket = (
    process.env.FIREBASE_STORAGE_BUCKET ||
    (matchesFileProject ? fileCfg.storageBucket : undefined) ||
    `${projectId}.firebasestorage.app`
  ).trim();

  if (!projectId || projectId === 'remixed-project-id') {
    throw new Error(
      'Configuration Firebase manquante ou invalide : projectId absent dans FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT ou firebase-applet-config.json.'
    );
  }

  cachedConfig = {
    projectId,
    firestoreDatabaseId,
    storageBucket: storageBucket || undefined,
  };
  return cachedConfig;
}

export function getAdminApp(): App {
  if (cachedApp) return cachedApp;

  const isProduction = process.env.NODE_ENV === 'production';
  const hasServiceAccountEnv = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT?.trim());

  if (isProduction || hasServiceAccountEnv) {
    const serviceAccount = parseServiceAccountFromEnv();
    const cfg = getFirebaseConfig(serviceAccount);

    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount as ServiceAccount),
        projectId: cfg.projectId,
        storageBucket: cfg.storageBucket,
      });
    }

    cachedApp = getApp();
    return cachedApp;
  }

  // En développement local / aperçu AI Studio uniquement si FIREBASE_SERVICE_ACCOUNT n'est pas défini
  const cfg = getFirebaseConfig();
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket,
    });
  }

  cachedApp = getApp();
  return cachedApp;
}

export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;
  const cfg = getFirebaseConfig();
  const app = getAdminApp();

  const db =
    cfg.firestoreDatabaseId && cfg.firestoreDatabaseId !== '(default)'
      ? getFirestore(app, cfg.firestoreDatabaseId)
      : getFirestore(app);

  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Settings may already be frozen if accessed earlier in the same process
  }

  cachedDb = db;
  return cachedDb;
}

export function getAdminAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getAdminApp());
  return cachedAuth;
}

export function getAdminStorageBucket() {
  const cfg = getFirebaseConfig();
  if (!cfg.storageBucket) return null;
  return getStorage(getAdminApp()).bucket(cfg.storageBucket);
}

export function isFirestorePermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  const msg = error instanceof Error ? error.message : String(error);
  return code === 7 || code === 'permission-denied' || msg.includes('PERMISSION_DENIED');
}

export function formatFirestoreError(context: string, error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (isFirestorePermissionDenied(error)) {
    return `[Firestore PERMISSION_DENIED] ${context} : vérifiez que le compte de service possède le rôle roles/datastore.user sur le projet cible. Détail : ${msg}`;
  }
  return `[Firestore Error] ${context} : ${msg}`;
}

export async function verifyFirestoreConnection(): Promise<{
  ok: true;
  projectId: string;
  databaseId: string;
}> {
  const cfg = getFirebaseConfig();
  const db = getAdminDb();
  await db.collection('systemMetadata').doc('bootstrap').get();
  return {
    ok: true,
    projectId: cfg.projectId,
    databaseId: cfg.firestoreDatabaseId || '(default)',
  };
}
