import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { loadFormConfig } from '../utils/formConfig.js';
import { uploadAnnonceImage } from '../utils/storageHelper.js';
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
import { isSuperAdminSetupNeeded } from '../modules/platform/platform.repository.js';
import {
  ALLOWED_MESSE_TYPES,
  createMesseForParish,
  listMassesForParish,
} from '../modules/masses/masses.service.js';
import {
  ANNONCE_TYPE_LABELS,
  createAnnouncementForParish,
  listAnnouncementsForParish,
} from '../modules/announcements/announcements.service.js';
import {
  INTENTION_STATUS_LABELS,
  listEnrichedIntentionsForParish,
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
import { getAdminAuth } from '../config/firebaseAdmin.js';
import { findUserByEmail, findUserById, saveUser } from '../repositories/users.repository.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

export const pageRouter = Router();

export async function buildParishDashboardData(parishId: string) {
  const [intentions, messes, annonces] = await Promise.all([
    listEnrichedIntentionsForParish(parishId),
    listMassesForParish(parishId),
    listAnnouncementsForParish(parishId),
  ]);

  const pendingCount = intentions.filter(
    (i) => i.status === 'PENDING' || i.status === 'PROCESSING'
  ).length;
  const acceptedCount = intentions.filter(
    (i) => i.status === 'ACCEPTED' || i.status === 'SCHEDULED'
  ).length;
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
    annonceTypeLabels: ANNONCE_TYPE_LABELS,
    messeTypes: ALLOWED_MESSE_TYPES,
    tariffs: INTENTION_TARIFFS,
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

pageRouter.post('/valide', async (req: Request, res: Response) => {
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

  const validation = await validateEcclesiasticalRegistration({
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

  const regResult = await registerPublicFideleAccount({
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

pageRouter.post('/verification', async (req: Request, res: Response) => {
  const { gmail = '', motdepasse = '' } = req.body as Record<string, string>;
  const rateKey = `${req.ip || 'local'}:${String(gmail).trim().toLowerCase()}`;
  const [limit, needsSuperAdminSetup] = await Promise.all([
    checkLoginRateLimit(rateKey),
    isSuperAdminSetupNeeded(),
  ]);

  const formData = loadFormConfig();

  if (!limit.allowed) {
    res.status(429).render('compte', {
      champs: formData.connection,
      error: `Trop de tentatives échouées. Réessayez dans ${limit.retryAfterSec} secondes.`,
      needsSuperAdminSetup,
    });
    return;
  }

  const auth = await authenticateWithCredentials(gmail, motdepasse);
  if (!auth.ok) {
    if (auth.code === 'SUPER_ADMIN_SETUP_REQUIRED') {
      await clearLoginFailures(rateKey);
      res.redirect('/setup-super-admin');
      return;
    }
    await recordLoginFailure(rateKey);
    res.status(401).render('compte', {
      champs: formData.connection,
      error: auth.message,
      needsSuperAdminSetup,
    });
    return;
  }

  await clearLoginFailures(rateKey);
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
        needsSuperAdminSetup,
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
  async (req: Request, res: Response) => {
    const { nouveau_motdepasse = '', confirmation = '' } = req.body as Record<string, string>;
    if (nouveau_motdepasse !== confirmation) {
      res.status(400).render('changer_mot_de_passe', {
        user: req.authContext!.user,
        error: 'Les deux mots de passe ne correspondent pas.',
      });
      return;
    }

    const result = await changeOwnPassword(req.authContext!.user.id, nouveau_motdepasse);
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
    req.session.save(() => {
      res.redirect('/page/tableau_bords');
    });
  }
);

pageRouter.get('/tableau_bords', requireAuth, async (req: Request, res: Response) => {
  const ctx = req.authContext!;
  if (ctx.user.isSuperAdmin) {
    res.redirect('/super-admin');
    return;
  }
  if (!ctx.activeParish || ctx.permissions.length === 0) {
    res.redirect('/demande-intention');
    return;
  }

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

  const [stats, members, auditLogs, notifications, paymentStats, paymentList] = await Promise.all([
    buildParishDashboardData(ctx.activeParish.id),
    ctx.permissions.includes('parish.users.view')
      ? listParishMembersDetailed(ctx.activeParish.id)
      : Promise.resolve([]),
    ctx.permissions.includes('parish.audit.view')
      ? listAuditLogs({ scope: 'PARISH', parishId: ctx.activeParish.id, limit: 40 })
      : Promise.resolve([]),
    listNotificationsForParish(ctx.activeParish.id, ctx.user.id),
    canViewPayments
      ? computePaymentStatistics({ parishId: ctx.activeParish.id })
      : Promise.resolve(null),
    canViewPayments
      ? listPaymentsFiltered({ parishId: ctx.activeParish.id, ...paymentFilters })
      : Promise.resolve(null),
  ]);

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
    res.render('ajoute_messe', { champs: formData.messes, error: null });
  }
);

pageRouter.post(
  '/ajoute_messe',
  requireParishPermission('parish.masses.manage'),
  verifyCsrfForSessionMutation,
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const {
      Celebrant_messe = '',
      date_messe = '',
      heure_messe = '',
      type_messe = 'Messe paroissiale',
      lieu_messe = '',
    } = req.body as Record<string, string>;

    const result = await createMesseForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      celebrant: Celebrant_messe,
      date: date_messe,
      horaire: heure_messe,
      type: type_messe,
      lieu: lieu_messe,
    });
    if (!result.ok) {
      const formData = loadFormConfig();
      res.status(result.status).render('ajoute_messe', {
        champs: formData.messes,
        error: result.error,
      });
      return;
    }
    res.redirect('/page/tableau_bords?section=masses');
  }
);

pageRouter.get(
  '/annonces',
  requireParishPermission('parish.announcements.publish'),
  (_req: Request, res: Response) => {
    const formData = loadFormConfig();
    res.render('annonces', { champs: formData.annonces, error: null });
  }
);

pageRouter.post(
  '/ajoute_annonce',
  requireParishPermission('parish.announcements.publish'),
  upload.single('image_annonce'),
  verifyCsrfForSessionMutation,
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const {
      type_annonces = 'Communique',
      Titre_annonce = '',
      date_annonce = '',
      contenu_annonce = '',
    } = req.body as Record<string, string>;

    const annonceId = `ann-${crypto.randomUUID().slice(0, 10)}`;
    const uploadResult = await uploadAnnonceImage(req.file, ctx.activeParish!.id, annonceId);
    if (!uploadResult.ok) {
      const formData = loadFormConfig();
      res.status(uploadResult.status).render('annonces', {
        champs: formData.annonces,
        error: uploadResult.error,
      });
      return;
    }

    const result = await createAnnouncementForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      annonceId,
      type: (type_annonces as AnnonceEntity['type']) || 'Communique',
      titre: Titre_annonce,
      dateAnnonce: date_annonce,
      contenu: contenu_annonce,
      imageUrl: uploadResult.imageUrl,
      canApproveDirectly: ctx.permissions.includes('parish.announcements.approve'),
    });

    if (!result.ok) {
      const formData = loadFormConfig();
      res.status(result.status).render('annonces', {
        champs: formData.annonces,
        error: result.error,
      });
      return;
    }

    res.redirect('/page/tableau_bords?section=announcements');
  }
);

pageRouter.get('/demande-intention', (_req: Request, res: Response) => {
  res.redirect('/demande-intention');
});

pageRouter.post('/demande-intention', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, string>;
  const result = await submitPublicIntention({
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

pageRouter.post('/firebase-session', async (req: Request, res: Response) => {
  const { idToken = '' } = (req.body ?? {}) as Record<string, string>;

  if (!idToken || typeof idToken !== 'string') {
    res.status(400).json({ error: 'Jeton d’authentification Firebase (idToken) manquant.' });
    return;
  }

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    res.status(401).json({ error: 'Jeton Firebase invalide ou expiré.' });
    return;
  }

  const cleanEmail = String(decoded.email || '').trim().toLowerCase();
  if (!cleanEmail || decoded.email_verified !== true) {
    res.status(403).json({ error: 'Adresse e-mail Google non vérifiée.' });
    return;
  }

  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'settaocram@gmail.com')
    .trim()
    .toLowerCase();

  let user = (await findUserByEmail(cleanEmail)) ?? (await findUserById(decoded.uid));

  if (!user) {
    const now = new Date().toISOString();
    user = {
      id: decoded.uid,
      email: cleanEmail,
      displayName: String(decoded.name || cleanEmail).trim().slice(0, 120),
      phone: decoded.phone_number ? String(decoded.phone_number).slice(0, 40) : '',
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
    await saveUser(user);
  } else {
    if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
      res.status(403).json({ error: 'Compte suspendu ou désactivé.' });
      return;
    }
    user.lastLoginAt = new Date().toISOString();
    user.updatedAt = user.lastLoginAt;
    await saveUser(user);
  }

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

export { requireParishContext };
