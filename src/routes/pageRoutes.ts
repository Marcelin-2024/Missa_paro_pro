import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { loadFormConfig } from '../utils/formConfig.js';
import {
  listProvincesSummary,
  validateEcclesiasticalRegistration,
} from '../modules/ecclesiastical/ecclesiastical.service.js';
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
  requireAuth,
  requireParishContext,
  requireParishPermission,
  verifyCsrfForSessionMutation,
} from '../modules/auth/auth.middleware.js';
import {
  authenticateWithCredentials,
  changeOwnPassword,
  listParishMembersDetailed,
  registerPublicFideleAccount,
} from '../modules/users/users.service.js';
import { getPlatformState, savePlatformState } from '../modules/platform/platform.repository.js';
import { createMesseForParish, listMassesForParish } from '../modules/masses/masses.service.js';
import {
  createAnnouncementForParish,
  listAnnouncementsForParish,
} from '../modules/announcements/announcements.service.js';
import {
  INTENTION_STATUS_LABELS,
  listIntentionsForParish,
  submitPublicIntention,
} from '../modules/intentions/intentions.service.js';
import { ALL_ROLE_CODES, PERMISSION_LABELS, ROLE_CATALOG } from '../modules/roles/rbac.catalog.js';
import { listAuditLogs } from '../modules/audit/audit.service.js';
import { listNotificationsForParish } from '../modules/notifications/notifications.service.js';
import {
  INTENTION_TARIFFS,
  PAYMENT_PROVIDERS_META,
  PAYMENT_STATUS_LABELS,
} from '../modules/payments/payment.config.js';
import { listPaymentsFiltered } from '../modules/payments/payments.service.js';
import { computePaymentStatistics } from '../modules/payments/payments.stats.js';
import type { AnnonceEntity } from '../modules/platform/platform.types.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

export const pageRouter = Router();

export function buildParishDashboardData(parishId: string) {
  const intentions = listIntentionsForParish(parishId);
  const messes = listMassesForParish(parishId);
  const annonces = listAnnouncementsForParish(parishId);

  const pendingCount = intentions.filter((i) => i.status === 'PENDING' || i.status === 'PROCESSING').length;
  const acceptedCount = intentions.filter((i) => i.status === 'ACCEPTED' || i.status === 'SCHEDULED').length;
  const celebratedCount = intentions.filter((i) => i.status === 'CELEBRATED').length;
  const messesCount = messes.filter((m) => m.statut === 'A venir').length;
  const annoncesCount = annonces.length;

  return {
    pendingCount,
    acceptedCount,
    celebratedCount,
    validatedCount: acceptedCount + celebratedCount,
    messesCount,
    annoncesCount,
    weeklyTotal: intentions.length,
    recentIntentions: intentions.slice(0, 5),
    allIntentions: intentions,
    allMesses: messes,
    allAnnonces: annonces,
    statusLabels: INTENTION_STATUS_LABELS,
  };
}

pageRouter.get('/inscription', (_req: Request, res: Response) => {
  const formData = loadFormConfig();
  res.render('inscription', {
    champs: formData.inscription_champs,
    provinces: listProvincesSummary(),
    error: null,
  });
});

pageRouter.post('/valide', (req: Request, res: Response) => {
  const {
    provinceId = '',
    dioceseId = '',
    parishId = '',
    missing_parish_name = '',
    parish_request_id = '',
    nom_complet = '',
    telephone = '',
    gmail = '',
    motdepasse = '',
    confirmationmotdepasse = '',
  } = req.body as Record<string, string>;

  const formData = loadFormConfig();

  if (confirmationmotdepasse && motdepasse !== confirmationmotdepasse) {
    res.status(400).render('inscription', {
      champs: formData.inscription_champs,
      provinces: listProvincesSummary(),
      error: 'Les mots de passe ne correspondent pas.',
    });
    return;
  }

  const validation = validateEcclesiasticalRegistration({
    provinceId,
    dioceseId,
    parishId,
    missingParishName: missing_parish_name,
    parishRequestId: parish_request_id,
  });

  if (!validation.valid) {
    res.status(400).render('inscription', {
      champs: formData.inscription_champs,
      provinces: listProvincesSummary(),
      error: validation.error,
    });
    return;
  }

  const regResult = registerPublicFideleAccount({
    displayName: nom_complet,
    email: gmail,
    phone: telephone,
    password: motdepasse,
    provinceId: validation.province.id,
    dioceseId: validation.diocese.id,
    parishId: validation.registration.parishId ?? undefined,
  });

  if (!regResult.ok) {
    res.status(regResult.status).render('inscription', {
      champs: formData.inscription_champs,
      provinces: listProvincesSummary(),
      error: regResult.error,
    });
    return;
  }

  res.redirect('/');
});

pageRouter.post('/verification', (req: Request, res: Response) => {
  const { gmail = '', motdepasse = '' } = req.body as Record<string, string>;
  const rateKey = `${req.ip || 'local'}:${String(gmail).trim().toLowerCase()}`;
  const limit = checkLoginRateLimit(rateKey);

  const formData = loadFormConfig();
  const state = getPlatformState();
  const needsSuperAdminSetup =
    !state.superAdminClaimed && !(process.env.SUPER_ADMIN_PASSWORD || '').trim();

  if (!limit.allowed) {
    res.status(429).render('compte', {
      champs: formData.connection,
      error: `Trop de tentatives échouées. Réessayez dans ${limit.retryAfterSec} secondes.`,
      needsSuperAdminSetup,
    });
    return;
  }

  const auth = authenticateWithCredentials(gmail, motdepasse);
  if (!auth.ok) {
    if (auth.code === 'SUPER_ADMIN_SETUP_REQUIRED') {
      clearLoginFailures(rateKey);
      res.redirect('/setup-super-admin');
      return;
    }
    recordLoginFailure(rateKey);
    res.status(401).render('compte', {
      champs: formData.connection,
      error: auth.message,
      needsSuperAdminSetup,
    });
    return;
  }

  clearLoginFailures(rateKey);
  req.session.uid = auth.user.id;
  req.session.user = {
    uid: auth.user.id,
    nom_complet: auth.user.displayName,
    paroisse: 'Espace Missa Paro',
    email: auth.user.email,
  };

  let nextUrl = '/page/tableau_bords';
  if (auth.user.mustChangePassword) {
    nextUrl = '/page/changer-mot-de-passe';
  } else if (auth.user.isSuperAdmin) {
    nextUrl = '/super-admin';
  } else if (auth.user.accountType === 'FIDELE') {
    nextUrl = '/demande-intention';
  }

  req.session.save((err) => {
    if (err) {
      res.status(500).render('compte', {
        champs: formData.connection,
        error: 'Erreur lors de la création de session.',
      });
      return;
    }
    res.render('verification', {
      reponse: auth.user.id,
      nextUrl,
      mustChangePassword: auth.user.mustChangePassword,
      isSuperAdmin: auth.user.isSuperAdmin,
    });
  });
});

pageRouter.get('/changer-mot-de-passe', requireAuth, (req: Request, res: Response) => {
  res.render('changer_mot_de_passe', {
    user: req.authContext!.user,
    error: null,
  });
});

pageRouter.post(
  '/changer-mot-de-passe',
  requireAuth,
  verifyCsrfForSessionMutation,
  (req: Request, res: Response) => {
    const { nouveau_motdepasse = '', confirmation = '' } = req.body as Record<string, string>;
    if (nouveau_motdepasse !== confirmation) {
      res.status(400).render('changer_mot_de_passe', {
        user: req.authContext!.user,
        error: 'Les deux mots de passe ne correspondent pas.',
      });
      return;
    }

    const result = changeOwnPassword(req.authContext!.user.id, nouveau_motdepasse);
    if (!result.ok) {
      res.status(result.status).render('changer_mot_de_passe', {
        user: req.authContext!.user,
        error: result.error,
      });
      return;
    }

    if (result.user.isSuperAdmin) {
      res.redirect('/super-admin');
      return;
    }
    res.redirect('/page/tableau_bords');
  }
);

pageRouter.post(
  '/switch-parish',
  requireAuth,
  verifyCsrfForSessionMutation,
  (req: Request, res: Response) => {
    const targetParishId = String((req.body as Record<string, string>)?.parishId || '').trim();
    const ctx = req.authContext!;
    const allowed = ctx.memberships.some((m) => m.parish?.id === targetParishId);
    if (!allowed) {
      res.status(403).redirect('/page/tableau_bords');
      return;
    }
    req.session.activeParishId = targetParishId;
    res.redirect('/page/tableau_bords');
  }
);

pageRouter.get('/tableau_bords', requireAuth, (req: Request, res: Response) => {
  const ctx = req.authContext!;
  if (ctx.user.isSuperAdmin) {
    res.redirect('/super-admin');
    return;
  }
  if (!ctx.activeParish || ctx.permissions.length === 0) {
    res.redirect('/demande-intention');
    return;
  }

  const stats = buildParishDashboardData(ctx.activeParish.id);
  const members = ctx.permissions.includes('parish.users.view')
    ? listParishMembersDetailed(ctx.activeParish.id)
    : [];
  const auditLogs = ctx.permissions.includes('parish.audit.view')
    ? listAuditLogs({ scope: 'PARISH', parishId: ctx.activeParish.id, limit: 40 })
    : [];
  const notifications = listNotificationsForParish(ctx.activeParish.id, ctx.user.id);

  const canViewPayments = ctx.permissions.includes('parish.payments.view');
  const paymentFilters = {
    q: typeof req.query.q === 'string' ? req.query.q : '',
    provider: typeof req.query.provider === 'string' ? req.query.provider : '',
    status: typeof req.query.status === 'string' ? req.query.status : '',
    dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '',
    dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : '',
    page: typeof req.query.page === 'string' ? Number(req.query.page) : 1,
    limit: 10,
  };
  const paymentStats = canViewPayments
    ? computePaymentStatistics({ parishId: ctx.activeParish.id })
    : null;
  const paymentList = canViewPayments
    ? listPaymentsFiltered({ parishId: ctx.activeParish.id, ...paymentFilters })
    : null;

  res.render('tableau_bords', {
    user: {
      uid: ctx.user.id,
      nom_complet: ctx.user.displayName,
      paroisse: ctx.activeParish.name,
      email: ctx.user.email,
    },
    activeParish: ctx.activeParish,
    activeRoles: ctx.activeRoles,
    permissions: ctx.permissions,
    memberships: ctx.memberships,
    roleCatalog: ROLE_CATALOG,
    roleCodes: ALL_ROLE_CODES,
    permissionLabels: PERMISSION_LABELS,
    stats,
    members,
    auditLogs,
    notifications,
    paymentStats,
    paymentList,
    paymentFilters,
    paymentProviders: PAYMENT_PROVIDERS_META,
    paymentStatusLabels: PAYMENT_STATUS_LABELS,
    section: String(req.query.section || 'overview'),
  });
});

pageRouter.get(
  '/messes',
  requireParishPermission('parish.masses.manage'),
  (_req: Request, res: Response) => {
    const formData = loadFormConfig();
    res.render('ajoute_messe', { champs: formData.messes });
  }
);

pageRouter.post(
  '/ajoute_messe',
  requireParishPermission('parish.masses.manage'),
  verifyCsrfForSessionMutation,
  (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const {
      Celebrant_messe = '',
      date_messe = '',
      heure_messe = '',
      type_messe = 'Messe paroissiale',
    } = req.body as Record<string, string>;

    createMesseForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      celebrant: Celebrant_messe,
      date: date_messe,
      horaire: heure_messe,
      type: type_messe,
    });
    res.redirect('/page/tableau_bords');
  }
);

pageRouter.get(
  '/annonces',
  requireParishPermission('parish.announcements.publish'),
  (_req: Request, res: Response) => {
    const formData = loadFormConfig();
    res.render('annonces', { champs: formData.annonces });
  }
);

pageRouter.post(
  '/ajoute_annonce',
  requireParishPermission('parish.announcements.publish'),
  upload.single('image_annonce'),
  verifyCsrfForSessionMutation,
  (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const {
      type_annonces = 'Communique',
      Titre_annonce = '',
      date_annonce = '',
      contenu_annonce = '',
    } = req.body as Record<string, string>;

    let imageUrl: string | undefined;
    if (req.file) {
      imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    createAnnouncementForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      type: (type_annonces as AnnonceEntity['type']) || 'Communique',
      titre: Titre_annonce,
      dateAnnonce: date_annonce,
      contenu: contenu_annonce,
      imageUrl,
      canApproveDirectly: ctx.permissions.includes('parish.announcements.approve'),
    });

    res.redirect('/page/tableau_bords');
  }
);

pageRouter.get('/demande-intention', (_req: Request, res: Response) => {
  res.redirect('/demande-intention');
});

pageRouter.post('/demande-intention', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, string>;
  const result = submitPublicIntention({
    provinceId: body.provinceId || '',
    dioceseId: body.dioceseId || '',
    parishId: body.parishId || '',
    requesterUserId: req.authContext?.user.id ?? null,
    requesterName: body.requesterName || '',
    requesterPhone: body.requesterPhone || '',
    requesterEmail: body.requesterEmail || '',
    intentionType: body.intentionType || '',
    objet: body.objet || '',
    details: body.details || '',
    desiredDate: body.desiredDate || null,
    messeId: body.messeId || null,
  });

  if (!result.ok) {
    res.status(result.status).render('demande_intention', {
      provinces: listProvincesSummary(),
      tariffs: INTENTION_TARIFFS,
      error: result.error,
      confirmation: null,
      trackingResult: null,
    });
    return;
  }

  res.status(201).render('demande_intention', {
    provinces: listProvincesSummary(),
    tariffs: INTENTION_TARIFFS,
    error: null,
    confirmation: {
      id: result.intention.id,
      trackingRef: result.intention.trackingRef,
      parishName: result.intention.parishName,
      objet: result.intention.objet,
      amount: result.intention.amount || 2000,
      currency: result.intention.currency || 'XOF',
      statusLabel: INTENTION_STATUS_LABELS[result.intention.status],
    },
    trackingResult: null,
  });
});

pageRouter.post('/firebase-session', (req: Request, res: Response) => {
  const {
    uid = '',
    nom_complet = 'Fidèle',
    email = '',
  } = (req.body ?? {}) as Record<string, string>;

  if (!uid || !email) {
    res.status(400).json({ error: 'UID ou email manquant' });
    return;
  }

  const cleanEmail = email.trim().toLowerCase();
  const state = getPlatformState();
  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'settaocram@gmail.com').trim().toLowerCase();
  let user = state.users.find((u) => u.email.toLowerCase() === cleanEmail || u.id === uid);

  if (!user) {
    const now = new Date().toISOString();
    user = {
      id: uid,
      email: cleanEmail,
      displayName: String(nom_complet || cleanEmail).trim().slice(0, 120),
      phone: '',
      passwordHash: null,
      accountType: cleanEmail === superAdminEmail ? 'SUPER_ADMIN' : 'FIDELE',
      isSuperAdmin: cleanEmail === superAdminEmail,
      status: 'ACTIVE',
      mustChangePassword: false,
      tempPasswordExpiresAt: null,
      activationTokenHash: null,
      activationExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    state.users.push(user);
    savePlatformState(state);
  }

  if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
    res.status(403).json({ error: 'Compte suspendu ou désactivé.' });
    return;
  }

  user.lastLoginAt = new Date().toISOString();
  user.updatedAt = user.lastLoginAt;
  savePlatformState(state);

  req.session.uid = user.id;
  req.session.user = {
    uid: user.id,
    nom_complet: user.displayName,
    paroisse: 'Espace Missa Paro',
    email: user.email,
  };

  const redirectTo = user.isSuperAdmin
    ? '/super-admin'
    : user.accountType === 'PARISH_STAFF'
      ? '/page/tableau_bords'
      : '/demande-intention';

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: 'Erreur lors de la création de session.' });
      return;
    }
    res.json({ success: true, redirectTo, id: crypto.randomUUID().slice(0, 8) });
  });
});

pageRouter.get('/logout', (req: Request, res: Response) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const isHttps = req.secure || forwardedProto === 'https';
  req.session.destroy(() => {
    res.clearCookie('connect.sid', {
      path: '/',
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
    });
    res.redirect('/');
  });
});

// Keep requireParishContext imported for downstream usage if needed
export { requireParishContext };
