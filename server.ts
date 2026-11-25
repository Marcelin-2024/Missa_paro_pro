import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { Request, Response } from 'express';
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
import { getPlatformState } from './src/modules/platform/platform.repository.js';
import {
  activateAccountWithToken,
  claimInitialSuperAdminPassword,
} from './src/modules/users/users.service.js';
import { listProvincesSummary } from './src/modules/ecclesiastical/ecclesiastical.service.js';
import { getPublicIntentionTracking } from './src/modules/intentions/intentions.service.js';
import { loadFormConfig } from './src/utils/formConfig.js';

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

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

function resolveSessionSecret(): string {
  const fromEnv = (process.env.SESSION_SECRET || '').trim();
  if (fromEnv) return fromEnv;
  const secretFile = path.join(process.cwd(), 'src', 'data', '.session-secret');
  try {
    if (fs.existsSync(secretFile)) {
      const stored = fs.readFileSync(secretFile, 'utf-8').trim();
      if (stored.length >= 32) return stored;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, generated, { encoding: 'utf-8', mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

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

app.use(
  session({
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

// Modular APIs & Spaces
app.use('/super-admin', superAdminRouter);
app.use('/api/super-admin', superAdminApiRouter);
app.use('/api/parish/intentions', intentionsParishRouter);
app.use('/api/parish', parishApiRouter);
app.use('/api/intentions', intentionsPublicRouter);
app.use('/api/ecclesiastical', ecclesiasticalRouter);
app.use('/api', apiRouter);

// Classic EJS Pages & Partials
app.use('/page', pageRouter);
app.use('/refresh', refreshRouter);

app.get('/', (_req: Request, res: Response) => {
  const formData = loadFormConfig();
  const state = getPlatformState();
  res.render('compte', {
    champs: formData.connection,
    error: null,
    needsSuperAdminSetup: !state.superAdminClaimed && !(process.env.SUPER_ADMIN_PASSWORD || '').trim(),
  });
});

app.get('/login', (_req: Request, res: Response) => {
  res.render('login');
});

app.get('/demande-intention', (req: Request, res: Response) => {
  const ref = typeof req.query.ref === 'string' ? req.query.ref : '';
  const trackingResult = ref ? getPublicIntentionTracking(ref) : null;
  res.render('demande_intention', {
    provinces: listProvincesSummary(),
    error: ref && !trackingResult ? `Aucune demande trouvée pour la référence « ${ref} ».` : null,
    confirmation: null,
    trackingResult,
  });
});

app.get('/annuaire', (_req: Request, res: Response) => {
  const state = getPlatformState();
  res.render('annuaire', {
    provinces: listProvincesSummary(),
    activeParishes: state.parishes.filter((p) => p.status === 'ACTIVE'),
  });
});

app.get('/activer-compte', (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  res.render('activer_compte', { token, error: null, success: false });
});

app.post('/activer-compte', (req: Request, res: Response) => {
  const { token = '', password = '', confirmation = '' } = req.body as Record<string, string>;
  if (password !== confirmation) {
    res.status(400).render('activer_compte', {
      token,
      error: 'Les mots de passe ne correspondent pas.',
      success: false,
    });
    return;
  }

  const result = activateAccountWithToken(token, password);
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

app.get('/setup-super-admin', (_req: Request, res: Response) => {
  const state = getPlatformState();
  if (state.superAdminClaimed || (process.env.SUPER_ADMIN_PASSWORD || '').trim()) {
    res.redirect('/');
    return;
  }
  const superAdmin = state.users.find((u) => u.isSuperAdmin);
  res.render('setup_super_admin', {
    email: superAdmin?.email || 'settaocram@gmail.com',
    error: null,
  });
});

app.post('/setup-super-admin', (req: Request, res: Response) => {
  const { email = '', password = '', confirmation = '' } = req.body as Record<string, string>;
  if (password !== confirmation) {
    res.status(400).render('setup_super_admin', {
      email,
      error: 'Les deux mots de passe ne correspondent pas.',
    });
    return;
  }

  const result = claimInitialSuperAdminPassword(email, password);
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

app.listen(PORT, HOST, () => {
  console.log(`Missa Paro server listening on http://${HOST}:${PORT}`);
});
