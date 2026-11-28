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

export const EXPECTED_PRODUCTION_PROJECT_ID = 'missaparo-70dfd';

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

export type FirestoreErrorCategory =
  | 'PERMISSION_DENIED'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'UNAVAILABLE'
  | 'DEADLINE_EXCEEDED'
  | 'INTERNAL';

export interface ClassifiedFirestoreError {
  category: FirestoreErrorCategory;
  httpStatus: number;
  publicCode: string;
  publicMessage: string;
  logMessage: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;
let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;
let loggedStartupIdentity = false;

function sanitizeErrorText(raw: string): string {
  return raw
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/"private_key"\s*:\s*"[^"]*"/gi, '"private_key":"[REDACTED]"')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
}

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

  const projectId = String(serviceAccount.project_id || serviceAccount.projectId || '').trim();
  if (!projectId) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT invalide : champ project_id manquant.');
  }

  const expectedProjectId = (
    process.env.EXPECTED_FIREBASE_PROJECT_ID || EXPECTED_PRODUCTION_PROJECT_ID
  ).trim();
  if (projectId !== expectedProjectId) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT invalide : project_id "${projectId}" ne correspond pas au projet attendu "${expectedProjectId}".`
    );
  }

  const clientEmail = String(serviceAccount.client_email || serviceAccount.clientEmail || '').trim();
  if (!clientEmail || !clientEmail.includes('@')) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT invalide : champ client_email manquant ou invalide.');
  }

  if (typeof serviceAccount.private_key === 'string' && serviceAccount.private_key.length > 0) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  if (typeof serviceAccount.privateKey === 'string' && serviceAccount.privateKey.length > 0) {
    serviceAccount.privateKey = serviceAccount.privateKey.replace(/\\n/g, '\n');
  }

  const resolvedPrivateKey = String(
    serviceAccount.private_key || serviceAccount.privateKey || ''
  ).trim();
  if (!resolvedPrivateKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT invalide : champ private_key manquant ou vide.');
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
      // Note : firebase-admin@14.5.1 convertit en interne ServiceAccountCredential en option
      // `credentials` vers @google-cloud/firestore@9 -> google-auth-library@11, ce qui peut
      // émettre un warning deprecated interne provenant du SDK lui-même.
      initializeApp({
        credential: cert(serviceAccount as ServiceAccount),
        projectId: cfg.projectId,
        storageBucket: cfg.storageBucket,
      });
    }

    cachedApp = getApp();
    if (!loggedStartupIdentity) {
      loggedStartupIdentity = true;
      console.info(
        `[FirebaseAdmin] Initialisé via FIREBASE_SERVICE_ACCOUNT (project_id=${cfg.projectId}, databaseId=${cfg.firestoreDatabaseId}, client_email=${serviceAccount.client_email || serviceAccount.clientEmail})`
      );
    }
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
  if (!loggedStartupIdentity) {
    loggedStartupIdentity = true;
    console.info(
      `[FirebaseAdmin] Initialisé via ADC développement (project_id=${cfg.projectId}, databaseId=${cfg.firestoreDatabaseId})`
    );
  }
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
  return classifyFirestoreError(error).category === 'PERMISSION_DENIED';
}

export function classifyFirestoreError(error: unknown): ClassifiedFirestoreError {
  const code =
    error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const rawMsg = error instanceof Error ? error.message : String(error ?? '');
  const msg = sanitizeErrorText(rawMsg);

  if (code === 7 || code === 'permission-denied' || msg.includes('PERMISSION_DENIED')) {
    return {
      category: 'PERMISSION_DENIED',
      httpStatus: 503,
      publicCode: 'FIRESTORE_PERMISSION_DENIED',
      publicMessage: 'Base de données Firestore inaccessible (autorisations IAM insuffisantes).',
      logMessage: `PERMISSION_DENIED (${msg})`,
    };
  }

  if (code === 16 || code === 'unauthenticated' || msg.includes('UNAUTHENTICATED')) {
    return {
      category: 'UNAUTHENTICATED',
      httpStatus: 503,
      publicCode: 'FIRESTORE_UNAUTHENTICATED',
      publicMessage: 'Authentification vers Firestore invalide ou expirée.',
      logMessage: `UNAUTHENTICATED (${msg})`,
    };
  }

  if (code === 5 || code === 'not-found' || msg.includes('NOT_FOUND')) {
    return {
      category: 'NOT_FOUND',
      httpStatus: 503,
      publicCode: 'FIRESTORE_NOT_FOUND',
      publicMessage: 'Ressource ou base Firestore introuvable.',
      logMessage: `NOT_FOUND (${msg})`,
    };
  }

  if (code === 14 || code === 'unavailable' || msg.includes('UNAVAILABLE')) {
    return {
      category: 'UNAVAILABLE',
      httpStatus: 503,
      publicCode: 'FIRESTORE_UNAVAILABLE',
      publicMessage: 'Service Firestore temporairement indisponible.',
      logMessage: `UNAVAILABLE (${msg})`,
    };
  }

  if (code === 4 || code === 'deadline-exceeded' || msg.includes('DEADLINE_EXCEEDED')) {
    return {
      category: 'DEADLINE_EXCEEDED',
      httpStatus: 504,
      publicCode: 'FIRESTORE_TIMEOUT',
      publicMessage: 'Délai de réponse Firestore dépassé.',
      logMessage: `DEADLINE_EXCEEDED (${msg})`,
    };
  }

  return {
    category: 'INTERNAL',
    httpStatus: 500,
    publicCode: 'FIRESTORE_ERROR',
    publicMessage: 'Erreur interne lors de l’accès à la base de données Firestore.',
    logMessage: `INTERNAL (${msg})`,
  };
}

export function formatFirestoreError(context: string, error: unknown): string {
  const classified = classifyFirestoreError(error);
  return `[Firestore ${classified.category}] ${context} : ${classified.logMessage}`;
}

export async function verifyFirestoreConnection(): Promise<{
  ok: true;
  projectId: string;
  databaseId: string;
}> {
  const db = getAdminDb();
  const cfg = getFirebaseConfig();
  await db.collection('systemMetadata').doc('bootstrap').get();
  return {
    ok: true,
    projectId: cfg.projectId,
    databaseId: cfg.firestoreDatabaseId || '(default)',
  };
}
