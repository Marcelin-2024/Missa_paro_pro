import fs from 'fs';
import path from 'path';
import {
  applicationDefault,
  getApp,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;
let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;

export function getFirebaseConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  let fileCfg: Partial<FirebaseAppletConfig> = {};

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileCfg = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
  }

  const projectId = (process.env.FIREBASE_PROJECT_ID || fileCfg.projectId || '').trim();
  const firestoreDatabaseId = (
    process.env.FIRESTORE_DATABASE_ID ||
    fileCfg.firestoreDatabaseId ||
    '(default)'
  ).trim();
  const storageBucket = (process.env.FIREBASE_STORAGE_BUCKET || fileCfg.storageBucket || '').trim();

  if (!projectId || projectId === 'remixed-project-id') {
    throw new Error(
      'Configuration Firebase manquante ou invalide : projectId absent dans firebase-applet-config.json ou FIREBASE_PROJECT_ID.'
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
  const cfg = getFirebaseConfig();

  cachedApp = getApps().length
    ? getApp()
    : initializeApp({
        credential: applicationDefault(),
        projectId: cfg.projectId,
        storageBucket: cfg.storageBucket,
      });

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
