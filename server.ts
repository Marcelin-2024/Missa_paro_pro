import 'dotenv/config';
import crypto from 'crypto';
import path from 'path';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import { pageRouter } from './src/routes/pageRoutes.js';
import { refreshRouter } from './src/routes/refreshRoutes.js';
import { apiRouter } from './src/routes/apiRoutes.js';
import { ecclesiasticalRouter } from './src/modules/ecclesiastical/ecclesiastical.routes.js';
import { superAdminApiRouter, superAdminRouter } from './src/modules/platform/superAdmin.routes.js';
import { parishApiRouter } from './src/modules/parishes/parishAdmin.routes.js';
import {
  intentionsParishRouter,
  intentionsPublicRouter,
} from './src/modules/intentions/intentions.routes.js';
import { attachSessionContext } from './src/modules/auth/auth.middleware.js';
import {
  FirestoreSessionStore,
  startSessionCleanupTimer,
} from './src/modules/auth/firestoreSessionStore.js';
import {
  ensureSuperAdminFromEnvIfUnclaimed,
  isSuperAdminSetupNeeded,
} from './src/modules/platform/platform.repository.js';
import { listActiveParishes } from './src/modules/parishes/parishes.service.js';
import { findSuperAdminUsers } from './src/repositories/users.repository.js';
import {
  activateAccountWithToken,
  claimInitialSuperAdminPassword,
} from './src/modules/users/users.service.js';
import { listProvincesSummary } from './src/modules/ecclesiastical/ecclesiastical.service.js';
import { getPublicIntentionTracking } from './src/modules/intentions/intentions.service.js';
import { paymentsApiRouter } from './src/modules/payments/payments.routes.js';
import {
  INTENTION_TARIFFS,
  PAYMENT_PROVIDERS_META,
  PAYMENT_SCENARIO_LABELS,
  PAYMENT_SIMULATION_CONFIG,
} from './src/modules/payments/payment.config.js';
import { getPublicPaymentByReference } from './src/modules/payments/payments.service.js';
import { loadFormConfig } from './src/utils/formConfig.js';
import {
  classifyFirestoreError,
  formatFirestoreError,
  initializeFirebaseRuntime,
  verifyFirestoreConnection,
} from './src/config/firebaseAdmin.js';

declare module 'express-session' {
  interface SessionData {
    uid?: string;
    activeParishId?: string;
    csrfToken?: string;
    user?: {
      uid: string;
      nom_complet: string;
      paroisse: string;
      email: string;
    };
  }
}

function resolveSessionSecret(): string {
  const fromEnv = (process.env.SESSION_SECRET || '').trim();
  if (fromEnv.length >= 32) {
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Variable d’environnement SESSION_SECRET manquante ou trop courte (minimum 32 caractères requis en production).'
    );
  }
  if (fromEnv) {
    console.warn(
      '[Security] SESSION_SECRET définie en développement fait moins de 32 caractères ; utilisez au moins 32 caractères avant le déploiement.'
    );
    return fromEnv;
  }
  console.warn(
    '[Security] SESSION_SECRET absente en développement : utilisation d’une clé éphémère en mémoire.'
  );
  return crypto.randomBytes(32).toString('hex');
}

export function createApp() {
  const app = express();
  const SESSION_SECRET = resolveSessionSecret();

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));

  app.use('/static', express.static(path.join(process.cwd(), 'public')));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use((req, _res, next) => {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    const origin = String(req.headers.origin || '').toLowerCase();
    const referer = String(req.headers.referer || '').toLowerCase();
    const proto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();

    if (
      proto !== 'https' &&
      (origin.startsWith('https://') ||
        referer.startsWith('https://') ||
        host.endsWith('.run.app') ||
        host.endsWith('.web.app') ||
        host.endsWith('.firebaseapp.com'))
    ) {
      req.headers['x-forwarded-proto'] = 'https';
    }
    next();
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'missa-paro' });
  });

  app.get('/health/ready', async (_req: Request, res: Response) => {
    try {
      await verifyFirestoreConnection();
      res.status(200).json({ status: 'ready', firestore: 'ok' });
    } catch (err) {
      const classified = classifyFirestoreError(err);
      console.error(formatFirestoreError('GET /health/ready', err));
      res.status(503).json({
        status: 'unavailable',
        firestore: 'error',
        code: classified.publicCode,
      });
    }
  });

  app.head('/', (_req: Request, res: Response) => {
    res.status(200).end();
  });

  app.use(
    session({
      store: new FirestoreSessionStore({ ttlMs: 1000 * 60 * 60 * 12 }),
      secret: SESSION_SECRET,
      proxy: true,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: 'auto',
        maxAge: 1000 * 60 * 60 * 12,
      },
    })
  );

  app.use((req, _res, next) => {
    if (req.session) {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();
      const isHttps = req.secure || forwardedProto === 'https';
      req.session.cookie.secure = isHttps;
      req.session.cookie.sameSite = isHttps ? 'none' : 'lax';
      (req.session.cookie as unknown as { partitioned?: boolean }).partitioned = isHttps;
    }
    next();
  });

  app.use(attachSessionContext);

  app.get('/api/auth/session-status', (req: Request, res: Response) => {
    res.json({
      authenticated: Boolean(req.authContext),
      isSuperAdmin: Boolean(req.authContext?.user.isSuperAdmin),
    });
  });

  app.use('/super-admin', superAdminRouter);
  app.use('/api/super-admin', superAdminApiRouter);
  app.use('/api/payments', paymentsApiRouter);
  app.use('/api/parish/intentions', intentionsParishRouter);
  app.use('/api/parish', parishApiRouter);
  app.use('/api/intentions', intentionsPublicRouter);
  app.use('/api/ecclesiastical', ecclesiasticalRouter);
  app.use('/api', apiRouter);

  app.use('/page', pageRouter);
  app.use('/refresh', refreshRouter);

  app.get('/', async (_req: Request, res: Response) => {
    const formData = loadFormConfig();
    const needsSuperAdminSetup = await isSuperAdminSetupNeeded();
    res.render('compte', {
      champs: formData.connection,
      error: null,
      needsSuperAdminSetup,
    });
  });

  app.get('/login', (_req: Request, res: Response) => {
    res.render('login');
  });

  app.get('/demande-intention', async (req: Request, res: Response) => {
    const ref = typeof req.query.ref === 'string' ? req.query.ref : '';
    const trackingResult = ref ? await getPublicIntentionTracking(ref) : null;
    res.render('demande_intention', {
      provinces: listProvincesSummary(),
      tariffs: INTENTION_TARIFFS,
      error: ref && !trackingResult ? `Aucune demande trouvée pour la référence « ${ref} ».` : null,
      confirmation: null,
      trackingResult,
    });
  });

  app.get('/paiement', (req: Request, res: Response) => {
    const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
    if (ref) {
      res.redirect(`/paiement/${encodeURIComponent(ref)}`);
      return;
    }
    res.render('paiement_intention', {
      intention: null,
      paymentLookup: null,
      providers: Object.values(PAYMENT_PROVIDERS_META),
      scenarios: PAYMENT_SCENARIO_LABELS,
      simulationConfig: PAYMENT_SIMULATION_CONFIG,
      error: null,
    });
  });

  app.get('/paiement/:trackingRef', async (req: Request, res: Response) => {
    const ref = String(req.params.trackingRef || '').trim();
    const [intention, paymentLookup] = await Promise.all([
      getPublicIntentionTracking(ref),
      getPublicPaymentByReference(ref),
    ]);
    res.render('paiement_intention', {
      intention,
      paymentLookup,
      providers: Object.values(PAYMENT_PROVIDERS_META),
      scenarios: PAYMENT_SCENARIO_LABELS,
      simulationConfig: PAYMENT_SIMULATION_CONFIG,
      error: !intention ? `Aucune intention trouvée pour la référence « ${ref} ».` : null,
    });
  });

  app.get('/annuaire', async (_req: Request, res: Response) => {
    const activeParishes = await listActiveParishes();
    res.render('annuaire', {
      provinces: listProvincesSummary(),
      activeParishes,
    });
  });

  app.get('/activer-compte', (req: Request, res: Response) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    res.render('activer_compte', { token, error: null, success: false });
  });

  app.post('/activer-compte', async (req: Request, res: Response) => {
    const { token = '', password = '', confirmation = '' } = req.body as Record<string, string>;
    if (password !== confirmation) {
      res.status(400).render('activer_compte', {
        token,
        error: 'Les mots de passe ne correspondent pas.',
        success: false,
      });
      return;
    }

    const result = await activateAccountWithToken(token, password);
    if (!result.ok) {
      res.status(result.status).render('activer_compte', {
        token,
        error: result.error,
        success: false,
      });
      return;
    }

    res.render('activer_compte', { token: '', error: null, success: true });
  });

  app.get('/setup-super-admin', async (_req: Request, res: Response) => {
    const needsSetup = await isSuperAdminSetupNeeded();
    if (!needsSetup) {
      res.redirect('/');
      return;
    }
    const superAdmins = await findSuperAdminUsers();
    const superAdmin = superAdmins[0];
    res.render('setup_super_admin', {
      email: superAdmin?.email || (process.env.SUPER_ADMIN_EMAIL || 'settaocram@gmail.com'),
      error: null,
    });
  });

  app.post('/setup-super-admin', async (req: Request, res: Response) => {
    const { email = '', password = '', confirmation = '' } = req.body as Record<string, string>;
    if (password !== confirmation) {
      res.status(400).render('setup_super_admin', {
        email,
        error: 'Les deux mots de passe ne correspondent pas.',
      });
      return;
    }

    const result = await claimInitialSuperAdminPassword(email, password);
    if (!result.ok) {
      res.status(result.status).render('setup_super_admin', {
        email,
        error: result.error,
      });
      return;
    }

    req.session.uid = result.user.id;
    req.session.user = {
      uid: result.user.id,
      nom_complet: result.user.displayName,
      paroisse: 'Super Administration Missa Paro',
      email: result.user.email,
    };
    req.session.save((err) => {
      if (err) {
        res.status(500).render('setup_super_admin', {
          email,
          error: 'Impossible d’initialiser la session.',
        });
        return;
      }
      res.redirect('/super-admin');
    });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const formatted = formatFirestoreError(`${req.method} ${req.originalUrl}`, err);
    console.error(formatted);

    const classified = classifyFirestoreError(err);

    if (req.originalUrl.startsWith('/api/') || req.accepts('json') === 'json') {
      res.status(classified.httpStatus).json({
        success: false,
        code: classified.publicCode,
        error: classified.publicMessage,
      });
      return;
    }

    res.status(classified.httpStatus).type('html').send(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Erreur serveur — Missa Paro</title></head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:4rem auto;padding:1.5rem;"><h1>Service temporairement indisponible</h1><p>${classified.publicMessage}</p></body></html>`
    );
  });

  return app;
}

if (process.env.MISSA_NO_LISTEN !== '1') {
  try {
    initializeFirebaseRuntime();
  } catch (err) {
    console.error(formatFirestoreError('Initialisation Firebase Admin au démarrage', err));
    process.exit(1);
  }

  const PORT = Number(process.env.PORT || 3000);
  const HOST = '0.0.0.0';
  const app = createApp();

  const cleanupTimer = startSessionCleanupTimer();

  void ensureSuperAdminFromEnvIfUnclaimed().catch((err) => {
    console.error(formatFirestoreError('Bootstrap Super Admin ENV', err));
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`Missa Paro server listening on http://${HOST}:${PORT}`);
  });

  const shutdown = (signal: NodeJS.Signals) => {
    console.info(`[Server] Signal ${signal} reçu, arrêt gracieux en cours...`);
    clearInterval(cleanupTimer);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
