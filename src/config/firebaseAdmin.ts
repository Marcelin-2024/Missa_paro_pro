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
  | 'WRONG_PROJECT'
  | 'WRONG_DATABASE_ID'
  | 'DATABASE_NOT_FOUND'
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

export interface FirebaseRuntimeIdentity {
  initialized: boolean;
  credentialSource: 'FIREBASE_SERVICE_ACCOUNT (cert)' | 'APPLICATION_DEFAULT_CREDENTIALS (ADC)' | 'UNINITIALIZED';
  projectId: string;
  clientEmail: string;
  databaseId: string;
  storageBucket: string | null;
}

interface InternalCredentialMeta {
  projectId?: string;
  clientEmail?: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;
let cachedCredentialSource: FirebaseRuntimeIdentity['credentialSource'] = 'UNINITIALIZED';
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

function validateFirestoreDatabaseId(rawDbId: string | undefined): string {
  const value = (rawDbId || '').trim();
  if (!value || value === '(default)') {
    return '(default)';
  }
  if (!/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(value)) {
    throw new Error(
      `Identifiant FIRESTORE_DATABASE_ID invalide : "${value}" (attendu : "(default)" ou 4 à 63 caractères [a-z0-9-]).`
    );
  }
  return value;
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

  const envProjectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  if (envProjectId && envProjectId !== projectId) {
    throw new Error(
      `Incohérence de configuration : FIREBASE_PROJECT_ID ("${envProjectId}") diffère de project_id dans FIREBASE_SERVICE_ACCOUNT ("${projectId}").`
    );
  }

  const clientEmail = String(serviceAccount.client_email || serviceAccount.clientEmail || '').trim();
  if (!clientEmail || !clientEmail.includes('@')) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT invalide : champ client_email manquant ou invalide.');
  }

  const expectedClientEmail = (process.env.EXPECTED_FIREBASE_CLIENT_EMAIL || '').trim();
  if (expectedClientEmail && clientEmail !== expectedClientEmail) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT invalide : client_email "${clientEmail}" ne correspond pas au compte attendu "${expectedClientEmail}".`
    );
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
  if (!resolvedPrivateKey.includes('BEGIN') || !resolvedPrivateKey.includes('PRIVATE KEY')) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT invalide : private_key PEM invalide ou tronquée.');
  }

  return serviceAccount;
}

function buildConfigFromServiceAccount(serviceAccount: RawServiceAccountJson): FirebaseAppletConfig {
  const projectId = String(serviceAccount.project_id || serviceAccount.projectId || '').trim();
  const firestoreDatabaseId = validateFirestoreDatabaseId(process.env.FIRESTORE_DATABASE_ID);
  const storageBucket = (
    process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`
  ).trim();

  return {
    projectId,
    firestoreDatabaseId,
    storageBucket: storageBucket || undefined,
  };
}

function buildDevConfigFromAppletOrEnv(): FirebaseAppletConfig {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  let fileCfg: Partial<FirebaseAppletConfig> = {};

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileCfg = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
  }

  const projectId = (process.env.FIREBASE_PROJECT_ID || fileCfg.projectId || '').trim();
  if (!projectId || projectId === 'remixed-project-id') {
    throw new Error(
      'Configuration Firebase manquante ou invalide : projectId absent dans FIREBASE_PROJECT_ID ou firebase-applet-config.json.'
    );
  }

  const matchesFileProject = Boolean(
    fileCfg.projectId && projectId === fileCfg.projectId.trim()
  );
  const firestoreDatabaseId = validateFirestoreDatabaseId(
    process.env.FIRESTORE_DATABASE_ID ||
      (matchesFileProject ? fileCfg.firestoreDatabaseId : undefined)
  );
  const storageBucket = (
    process.env.FIREBASE_STORAGE_BUCKET ||
    (matchesFileProject ? fileCfg.storageBucket : undefined) ||
    `${projectId}.firebasestorage.app`
  ).trim();

  return {
    projectId,
    firestoreDatabaseId,
    storageBucket: storageBucket || undefined,
  };
}

export function getFirebaseConfig(serviceAccount?: RawServiceAccountJson): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;

  const isProduction = process.env.NODE_ENV === 'production';
  const hasServiceAccountEnv = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT?.trim());

  if (serviceAccount) {
    cachedConfig = buildConfigFromServiceAccount(serviceAccount);
    return cachedConfig;
  }

  if (isProduction || hasServiceAccountEnv) {
    const parsedSa = parseServiceAccountFromEnv();
    cachedConfig = buildConfigFromServiceAccount(parsedSa);
    return cachedConfig;
  }

  cachedConfig = buildDevConfigFromAppletOrEnv();
  return cachedConfig;
}

export function getAdminApp(): App {
  if (cachedApp) return cachedApp;

  const isProduction = process.env.NODE_ENV === 'production';
  const hasServiceAccountEnv = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT?.trim());

  if (getApps().length > 1) {
    throw new Error(
      `Configuration Firebase Admin invalide : ${getApps().length} instances Firebase App détectées (une seule est autorisée).`
    );
  }

  if (isProduction || hasServiceAccountEnv) {
    const serviceAccount = parseServiceAccountFromEnv();
    const cfg = buildConfigFromServiceAccount(serviceAccount);
    cachedConfig = cfg;
    cachedCredentialSource = 'FIREBASE_SERVICE_ACCOUNT (cert)';

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

    const app = getApp();
    if (app.options.projectId && app.options.projectId !== cfg.projectId) {
      throw new Error(
        `Incohérence Firebase Admin : l'application initialisée cible "${app.options.projectId}" au lieu de "${cfg.projectId}".`
      );
    }

    cachedApp = app;
    return cachedApp;
  }

  // En développement local / aperçu AI Studio uniquement si FIREBASE_SERVICE_ACCOUNT n'est pas défini
  const cfg = buildDevConfigFromAppletOrEnv();
  cachedConfig = cfg;
  cachedCredentialSource = 'APPLICATION_DEFAULT_CREDENTIALS (ADC)';

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket,
    });
  }

  const app = getApp();
  if (app.options.projectId && app.options.projectId !== cfg.projectId) {
    throw new Error(
      `Incohérence Firebase Admin : l'application initialisée cible "${app.options.projectId}" au lieu de "${cfg.projectId}".`
    );
  }

  cachedApp = app;
  return cachedApp;
}

function readFirestoreProjectId(db: Firestore): string | undefined {
  const maybeWithToJson = db as unknown as {
    toJSON?: () => { projectId?: string };
    _projectId?: string;
  };
  const fromJson = maybeWithToJson.toJSON?.()?.projectId;
  return fromJson || maybeWithToJson._projectId || undefined;
}

export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;

  // Toujours initialiser l'App (et les credentials) AVANT de résoudre la configuration Firestore
  const app = getAdminApp();
  const cfg = getFirebaseConfig();

  const db =
    cfg.firestoreDatabaseId && cfg.firestoreDatabaseId !== '(default)'
      ? getFirestore(app, cfg.firestoreDatabaseId)
      : getFirestore(app);

  const effectiveDatabaseId = db.databaseId || '(default)';
  if (effectiveDatabaseId !== cfg.firestoreDatabaseId) {
    throw new Error(
      `Incohérence databaseId Firestore : instance configurée sur "${effectiveDatabaseId}" au lieu de "${cfg.firestoreDatabaseId}".`
    );
  }

  const effectiveDbProjectId = readFirestoreProjectId(db);
  if (effectiveDbProjectId && effectiveDbProjectId !== cfg.projectId) {
    throw new Error(
      `Incohérence projectId Firestore : instance configurée sur "${effectiveDbProjectId}" au lieu de "${cfg.projectId}".`
    );
  }

  const credMeta = app.options.credential as InternalCredentialMeta | undefined;
  if (credMeta?.projectId && credMeta.projectId !== cfg.projectId) {
    throw new Error(
      `Incohérence credential project_id : "${credMeta.projectId}" diffère du projet Firestore "${cfg.projectId}".`
    );
  }

  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Settings may already be frozen if accessed earlier in the same process
  }

  cachedDb = db;
  logEffectiveIdentityOnce();
  return cachedDb;
}

export function getFirebaseRuntimeIdentity(): FirebaseRuntimeIdentity {
  if (!cachedApp && !getApps().length) {
    return {
      initialized: false,
      credentialSource: 'UNINITIALIZED',
      projectId: '(non initialisé)',
      clientEmail: '(non initialisé)',
      databaseId: '(non initialisé)',
      storageBucket: null,
    };
  }

  const app = cachedApp || getApp();
  const credMeta = app.options.credential as InternalCredentialMeta | undefined;
  const dbProjectId = cachedDb ? readFirestoreProjectId(cachedDb) : undefined;

  const projectId =
    dbProjectId ||
    credMeta?.projectId ||
    app.options.projectId ||
    cachedConfig?.projectId ||
    '(inconnu)';
  const clientEmail =
    credMeta?.clientEmail ||
    (cachedCredentialSource === 'APPLICATION_DEFAULT_CREDENTIALS (ADC)'
      ? 'ADC (compte de service d’exécution)'
      : '(inconnu)');
  const databaseId =
    cachedDb?.databaseId ||
    cachedConfig?.firestoreDatabaseId ||
    '(non initialisé)';

  return {
    initialized: getApps().length === 1 && Boolean(cachedDb),
    credentialSource: cachedCredentialSource,
    projectId,
    clientEmail,
    databaseId,
    storageBucket: app.options.storageBucket || null,
  };
}

function logEffectiveIdentityOnce(): void {
  if (loggedStartupIdentity) return;
  loggedStartupIdentity = true;
  const id = getFirebaseRuntimeIdentity();
  console.info(
    `[FirebaseAdmin] Initialisé | state=${id.initialized ? 'ready' : 'partial'} | source=${id.credentialSource} | project_id=${id.projectId} | client_email=${id.clientEmail} | databaseId=${id.databaseId}`
  );
}

export function initializeFirebaseRuntime(): FirebaseRuntimeIdentity {
  getAdminApp();
  getAdminDb();
  logEffectiveIdentityOnce();
  return getFirebaseRuntimeIdentity();
}

export function getAdminAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getAdminApp());
  return cachedAuth;
}

export function getAdminStorageBucket() {
  getAdminApp();
  const cfg = getFirebaseConfig();
  if (!cfg.storageBucket) return null;
  return getStorage(getAdminApp()).bucket(cfg.storageBucket);
}

export function isFirestorePermissionDenied(error: unknown): boolean {
  return classifyFirestoreError(error).category === 'PERMISSION_DENIED';
}

export function classifyFirestoreError(error: unknown): ClassifiedFirestoreError {
  const errObj = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown; details?: unknown }) : undefined;
  const code = errObj?.code;
  const baseMsg =
    error instanceof Error
      ? error.message
      : errObj?.message !== undefined
        ? String(errObj.message)
        : String(error ?? '');
  const details = errObj?.details !== undefined ? String(errObj.details) : '';
  const rawMsg = details && !baseMsg.includes(details) ? `${baseMsg} (${details})` : baseMsg;
  const msg = sanitizeErrorText(rawMsg);
  const lower = msg.toLowerCase();

  // 1. Mauvais projet / conflit de project_id
  if (
    lower.includes('ne correspond pas au projet attendu') ||
    lower.includes('diffère de project_id') ||
    lower.includes('incohérence projectid') ||
    lower.includes('unknown project') ||
    (!lower.includes('database') && lower.includes('project') && lower.includes('does not exist'))
  ) {
    return {
      category: 'WRONG_PROJECT',
      httpStatus: 503,
      publicCode: 'FIRESTORE_WRONG_PROJECT',
      publicMessage: 'Configuration Firestore invalide (projet Firebase cible incorrect).',
      logMessage: `WRONG_PROJECT (${msg})`,
    };
  }

  // 2. Mauvais databaseId (syntaxe invalide ou databaseId personnalisé inexistant)
  if (
    lower.includes('firestore_database_id invalide') ||
    lower.includes('incohérence databaseid') ||
    ((code === 3 || code === 'invalid-argument') && lower.includes('database'))
  ) {
    return {
      category: 'WRONG_DATABASE_ID',
      httpStatus: 503,
      publicCode: 'FIRESTORE_WRONG_DATABASE_ID',
      publicMessage: 'Configuration Firestore invalide (identifiant de base databaseId incorrect).',
      logMessage: `WRONG_DATABASE_ID (${msg})`,
    };
  }

  // 3. Base Firestore inexistante (5 NOT_FOUND ciblant /databases/<id> ou database ... does not exist)
  if (
    (code === 5 || code === 'not-found' || msg.includes('NOT_FOUND')) &&
    (lower.includes('database') || lower.includes('does not exist') || lower.includes('/databases/'))
  ) {
    return {
      category: 'DATABASE_NOT_FOUND',
      httpStatus: 503,
      publicCode: 'FIRESTORE_DATABASE_NOT_FOUND',
      publicMessage: 'Base de données Firestore introuvable sur le projet configuré.',
      logMessage: `DATABASE_NOT_FOUND (${msg})`,
    };
  }

  // 4. Permission IAM insuffisante (7 PERMISSION_DENIED) ou API Firestore désactivée
  if (code === 7 || code === 'permission-denied' || msg.includes('PERMISSION_DENIED')) {
    const apiDisabled =
      lower.includes('service_disabled') ||
      lower.includes('firestore.googleapis.com') && lower.includes('disabled');
    return {
      category: 'PERMISSION_DENIED',
      httpStatus: 503,
      publicCode: 'FIRESTORE_PERMISSION_DENIED',
      publicMessage: apiDisabled
        ? 'API Cloud Firestore désactivée sur le projet Firebase cible.'
        : 'Base de données Firestore inaccessible (autorisations IAM insuffisantes).',
      logMessage: apiDisabled
        ? `PERMISSION_DENIED [API_DISABLED] (${msg})`
        : `PERMISSION_DENIED [IAM] (${msg})`,
    };
  }

  // 5. Erreur d’authentification (clé de service invalide, PEM, OAuth, credentials absentes)
  if (
    code === 16 ||
    code === 'unauthenticated' ||
    msg.includes('UNAUTHENTICATED') ||
    lower.includes('firebase_service_account') ||
    lower.includes('invalid_grant') ||
    lower.includes('invalid_client') ||
    lower.includes('could not load the default credentials') ||
    lower.includes('private_key')
  ) {
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
      publicMessage: 'Ressource Firestore introuvable.',
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
  await db.collection('_system_healthchecks').doc('readiness').get();
  const identity = getFirebaseRuntimeIdentity();
  return {
    ok: true,
    projectId: identity.projectId,
    databaseId: identity.databaseId,
  };
}
