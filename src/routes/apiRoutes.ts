import { Router, Request, Response } from 'express';
import { validateEcclesiasticalRegistration } from '../modules/ecclesiastical/ecclesiastical.service.js';
import {
  authenticateWithCredentials,
  registerPublicFideleAccount,
} from '../modules/users/users.service.js';
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
  requireAuth,
} from '../modules/auth/auth.middleware.js';
import {
  submitPublicIntention,
  transitionIntentionStatus,
} from '../modules/intentions/intentions.service.js';
import { findParishByIdOrDirectoryRepo } from '../repositories/parishes.repository.js';
import {
  listAllMessesRepo,
  listMessesByParishRepo,
  listPublishedAnnoncesRepo,
} from '../repositories/massesAnnouncements.repository.js';
import {
  listIntentionsByRequesterRepo,
  listValidatedPublicIntentionsRepo,
} from '../repositories/intentions.repository.js';
import {
  saveContactRepo,
  savePushTokenRepo,
  saveReviewRepo,
} from '../repositories/secondary.repository.js';

export const apiRouter = Router();

apiRouter.post('/fideles', async (req: Request, res: Response) => {
  const data = req.body as Record<string, string> | undefined;
  if (!data || Object.keys(data).length === 0) {
    res.status(400).json({
      success: false,
      data: 'mauvais envoie du fichier json',
    });
    return;
  }

  const nom = data.nom ?? '';
  const prenoms = data.prenoms ?? '';
  const email = data.email ?? '';
  const password = data.password ?? '';
  const telephone = data.telephone ?? '';
  const nom_complet = data.nom_complet ? data.nom_complet.trim() : `${nom} ${prenoms}`.trim();

  let provinceId = data.provinceId || 'province_abidjan';
  let dioceseId = data.dioceseId || 'diocese_abidjan';
  let parishId = data.parishId || undefined;
  let ecclesiastical;

  if (data.provinceId || data.dioceseId || data.parishId || data.missingParishName) {
    const validation = await validateEcclesiasticalRegistration({
      provinceId: data.provinceId,
      dioceseId: data.dioceseId,
      parishId: data.parishId,
      missingParishName: data.missingParishName,
      parishRequestId: data.parishRequestId,
    });

    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: validation.error,
      });
      return;
    }

    provinceId = validation.province.id;
    dioceseId = validation.diocese.id;
    parishId = validation.registration.parishId ?? undefined;
    ecclesiastical = validation.registration;
  }

  const created = await registerPublicFideleAccount({
    displayName: nom_complet,
    email,
    phone: telephone,
    password,
    provinceId,
    dioceseId,
    parishId,
  });

  if (!created.ok) {
    res.status(created.status).json({
      success: false,
      error: created.error,
    });
    return;
  }

  res.status(201).json({
    success: true,
    data: 'donnée envoyée',
    user: created.user,
    ecclesiastical,
  });
});

apiRouter.post('/login', async (req: Request, res: Response) => {
  const { email = '', password = '' } = (req.body ?? {}) as Record<string, string>;
  const rateKey = `${req.ip || 'local'}:${String(email).trim().toLowerCase()}`;
  const limit = await checkLoginRateLimit(rateKey);
  if (!limit.allowed) {
    res.status(429).json({
      status: 'error',
      message: 'TOO_MANY_ATTEMPTS',
      retryAfterSec: limit.retryAfterSec,
    });
    return;
  }

  const auth = await authenticateWithCredentials(email, password);
  if (!auth.ok) {
    await recordLoginFailure(rateKey);
    res.status(auth.code === 'ACCOUNT_SUSPENDED' ? 403 : 401).json({
      status: 'error',
      code: auth.code,
      message: auth.message,
    });
    return;
  }

  await clearLoginFailures(rateKey);
  req.session.uid = auth.user.id;
  req.session.save((err) => {
    if (err) {
      res.status(500).json({ status: 'error', message: 'SESSION_SAVE_ERROR' });
      return;
    }
    res.status(200).json({
      status: 'success',
      email: auth.user.email,
      uid: auth.user.id,
      isSuperAdmin: auth.user.isSuperAdmin,
      mustChangePassword: auth.user.mustChangePassword,
    });
  });
});

apiRouter.get('/paroisse/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  const parish = await findParishByIdOrDirectoryRepo(id);
  if (!parish) {
    res.status(404).json({ error: 'Paroisse introuvable' });
    return;
  }
  res.json({
    id: parish.id,
    name: parish.name,
    location: parish.location,
    provinceName: parish.provinceName,
    dioceseName: parish.dioceseName,
    status: parish.status,
    phone: parish.phone,
    email: parish.email,
    address: parish.address,
    massScheduleSummary: parish.massScheduleSummary,
    chapelsEnabled: parish.chapelsEnabled,
    chapels: parish.chapels,
  });
});

apiRouter.get('/messes', async (req: Request, res: Response) => {
  const requestedParishId =
    typeof req.query.parishId === 'string' && req.query.parishId.trim()
      ? req.query.parishId.trim()
      : req.authContext?.activeParish?.id;

  if (!requestedParishId) {
    if (req.authContext?.user.isSuperAdmin) {
      const all = await listAllMessesRepo();
      res.json(all);
      return;
    }
    res.status(400).json({
      success: false,
      error: 'Le paramètre parishId est requis pour consulter les messes d’une paroisse.',
    });
    return;
  }

  const rows = await listMessesByParishRepo(requestedParishId);
  res.json(rows);
});

apiRouter.get('/annonces', async (req: Request, res: Response) => {
  const requestedParishId =
    typeof req.query.parishId === 'string' && req.query.parishId.trim()
      ? req.query.parishId.trim()
      : req.authContext?.activeParish?.id;

  if (!requestedParishId && !req.authContext?.user.isSuperAdmin) {
    res.status(400).json({
      success: false,
      error: 'Le paramètre parishId est requis pour consulter les annonces d’une paroisse.',
    });
    return;
  }

  const rows = await listPublishedAnnoncesRepo(requestedParishId);
  res.json(rows);
});

apiRouter.post('/intentions', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown> | undefined;
  const payload = (body && typeof body.data === 'object' && body.data !== null
    ? body.data
    : body) as Record<string, string | undefined> | undefined;

  if (!payload || Object.keys(payload).length === 0) {
    res.status(400).json({ success: false, data: 'mauvais envoie du fichier json' });
    return;
  }

  const rawParishId = String(payload.parishId || payload.paroisse_id || '').trim();
  const matchedParish = rawParishId ? await findParishByIdOrDirectoryRepo(rawParishId) : null;

  const result = await submitPublicIntention({
    provinceId: payload.provinceId || matchedParish?.provinceId || '',
    dioceseId: payload.dioceseId || matchedParish?.dioceseId || '',
    parishId: matchedParish?.id || rawParishId,
    requesterUserId: req.authContext?.user.id ?? (payload.fidele_id ? String(payload.fidele_id) : null),
    requesterName: payload.requesterName || payload.nom_demandeur || 'Fidèle',
    requesterPhone: payload.requesterPhone || payload.telephone || '+22500000000',
    requesterEmail: payload.requesterEmail || payload.email || '',
    intentionType: payload.intentionType || payload.type_intention || '',
    objet: payload.objet || payload.objet_intention || payload.type_intention || '',
    details: payload.details || payload.detail_intention || '',
    desiredDate: payload.desiredDate || null,
    messeId: payload.messe_id ? String(payload.messe_id) : null,
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.status(201).json({
    success: true,
    data: 'donnée envoyée',
    trackingRef: result.intention.trackingRef,
    intentionId: result.intention.id,
    amount: result.intention.amount,
    currency: result.intention.currency,
  });
});

apiRouter.put('/intentions/:id', requireAuth, async (req: Request, res: Response) => {
  const ctx = req.authContext!;
  if (!ctx.activeParish || !ctx.permissions.includes('parish.intentions.process')) {
    res.status(403).json({ success: false, error: 'Permission insuffisante.' });
    return;
  }
  const { status = 'PROCESSING', internalComment = '' } = (req.body ?? {}) as Record<string, string>;
  const result = await transitionIntentionStatus({
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    parishId: ctx.activeParish.id,
    intentionId: String(req.params.id || ''),
    nextStatus: status as 'PROCESSING',
    internalComment,
  });
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, intention: result.intention });
});

apiRouter.get('/intentions/mes', requireAuth, async (req: Request, res: Response) => {
  const uid = req.authContext!.user.id;
  const items = await listIntentionsByRequesterRepo(uid);
  const rows = items.map(({ internalComment: _hidden, ...publicFields }) => publicFields);
  res.json(rows);
});

apiRouter.get('/intentions/validees', async (req: Request, res: Response) => {
  const parishId =
    typeof req.query.parishId === 'string' && req.query.parishId.trim()
      ? req.query.parishId.trim()
      : req.authContext?.activeParish?.id;

  const items = await listValidatedPublicIntentionsRepo(parishId);
  const rows = items.map(
    ({ internalComment: _hidden, requesterPhone: _p, requesterEmail: _e, ...safe }) => safe
  );
  res.json(rows);
});

apiRouter.post('/notifications/registerPush', async (req: Request, res: Response) => {
  const { token = 'registered' } = (req.body ?? {}) as Record<string, string>;
  const uid = req.authContext?.user.id ?? req.session.uid ?? 'anonymous';
  await savePushTokenRepo(uid, token);
  res.json({ status: 'Success', token: 'registered' });
});

apiRouter.post('/contact', async (req: Request, res: Response) => {
  const { message = '' } = (req.body ?? {}) as Record<string, string>;
  await saveContactRepo(message);
  res.json({ message: 'Message de contact bien reçu' });
});

apiRouter.post('/avis', async (req: Request, res: Response) => {
  const { note = 5, commentaire = '' } = (req.body ?? {}) as Record<string, unknown>;
  await saveReviewRepo(req.authContext?.user.id ?? req.session.uid, Number(note), String(commentaire));
  res.json({ message: 'Merci pour votre note !' });
});
