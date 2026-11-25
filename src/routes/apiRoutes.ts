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
import { getPlatformState } from '../modules/platform/platform.repository.js';
import {
  submitPublicIntention,
  transitionIntentionStatus,
} from '../modules/intentions/intentions.service.js';
import {
  addAvis,
  addContact,
  pushTokens,
} from '../store/inMemoryDb.js';

export const apiRouter = Router();

apiRouter.post('/fideles', (req: Request, res: Response) => {
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
    const validation = validateEcclesiasticalRegistration({
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

  const created = registerPublicFideleAccount({
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

apiRouter.post('/login', (req: Request, res: Response) => {
  const { email = '', password = '' } = (req.body ?? {}) as Record<string, string>;
  const rateKey = `${req.ip || 'local'}:${String(email).trim().toLowerCase()}`;
  const limit = checkLoginRateLimit(rateKey);
  if (!limit.allowed) {
    res.status(429).json({
      status: 'error',
      message: 'TOO_MANY_ATTEMPTS',
      retryAfterSec: limit.retryAfterSec,
    });
    return;
  }

  const auth = authenticateWithCredentials(email, password);
  if (!auth.ok) {
    recordLoginFailure(rateKey);
    res.status(auth.code === 'ACCOUNT_SUSPENDED' ? 403 : 401).json({
      status: 'error',
      code: auth.code,
      message: auth.message,
    });
    return;
  }

  clearLoginFailures(rateKey);
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

apiRouter.get('/paroisse/:id', (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  const state = getPlatformState();
  const parish = state.parishes.find((p) => p.id === id || p.directoryParishId === id);
  if (!parish) {
    res.status(404).json({ error: 'Paroisse introuvable' });
    return;
  }
  // Expose public practical information only (no private staff/user lists)
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

apiRouter.get('/messes', (req: Request, res: Response) => {
  const parishId = typeof req.query.parishId === 'string' ? req.query.parishId : req.authContext?.activeParish?.id;
  const state = getPlatformState();
  const rows = parishId ? state.messes.filter((m) => m.parishId === parishId) : state.messes;
  res.json(rows);
});

apiRouter.get('/annonces', (req: Request, res: Response) => {
  const parishId = typeof req.query.parishId === 'string' ? req.query.parishId : req.authContext?.activeParish?.id;
  const state = getPlatformState();
  const rows = parishId
    ? state.annonces.filter((a) => a.parishId === parishId && a.statut === 'PUBLISHED')
    : state.annonces.filter((a) => a.statut === 'PUBLISHED');
  res.json(rows);
});

apiRouter.post('/intentions', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown> | undefined;
  const payload = (body && typeof body.data === 'object' && body.data !== null
    ? body.data
    : body) as Record<string, string | undefined> | undefined;

  if (!payload || Object.keys(payload).length === 0) {
    res.status(400).json({ success: false, data: 'mauvais envoie du fichier json' });
    return;
  }

  const parishId = String(payload.parishId || payload.paroisse_id || 'parish_sainte_rita');
  const state = getPlatformState();
  const matchedParish = state.parishes.find((p) => p.id === parishId || p.directoryParishId === parishId);

  const result = submitPublicIntention({
    provinceId: payload.provinceId || matchedParish?.provinceId || 'province_abidjan',
    dioceseId: payload.dioceseId || matchedParish?.dioceseId || 'diocese_abidjan',
    parishId: matchedParish?.id || parishId,
    requesterUserId: req.authContext?.user.id ?? (payload.fidele_id ? String(payload.fidele_id) : null),
    requesterName: payload.requesterName || payload.nom_demandeur || 'Fidèle',
    requesterPhone: payload.requesterPhone || payload.telephone || '+22500000000',
    requesterEmail: payload.requesterEmail || payload.email || '',
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
  });
});

apiRouter.put('/intentions/:id', requireAuth, (req: Request, res: Response) => {
  const ctx = req.authContext!;
  if (!ctx.activeParish || !ctx.permissions.includes('parish.intentions.process')) {
    res.status(403).json({ success: false, error: 'Permission insuffisante.' });
    return;
  }
  const { status = 'PROCESSING', internalComment = '' } = (req.body ?? {}) as Record<string, string>;
  const result = transitionIntentionStatus({
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

apiRouter.get('/intentions/mes', requireAuth, (req: Request, res: Response) => {
  const uid = req.authContext!.user.id;
  const rows = getPlatformState()
    .intentions.filter((item) => item.requesterUserId === uid)
    .map(({ internalComment: _hidden, ...publicFields }) => publicFields);
  res.json(rows);
});

apiRouter.get('/intentions/validees', (req: Request, res: Response) => {
  const parishId = typeof req.query.parishId === 'string' ? req.query.parishId : undefined;
  const rows = getPlatformState()
    .intentions.filter(
      (item) =>
        (item.status === 'ACCEPTED' || item.status === 'SCHEDULED') &&
        (!parishId || item.parishId === parishId)
    )
    .map(({ internalComment: _hidden, requesterPhone: _p, requesterEmail: _e, ...safe }) => safe);
  res.json(rows);
});

apiRouter.post('/notifications/registerPush', (req: Request, res: Response) => {
  const { token = 'registered' } = (req.body ?? {}) as Record<string, string>;
  const uid = req.session.uid ?? 'anonymous';
  pushTokens.set(uid, token);
  res.json({ status: 'Success', token: 'registered' });
});

apiRouter.post('/contact', (req: Request, res: Response) => {
  const { message = '' } = (req.body ?? {}) as Record<string, string>;
  addContact(message);
  res.json({ message: 'Message de contact bien reçu' });
});

apiRouter.post('/avis', (req: Request, res: Response) => {
  const { note = 5, commentaire = '' } = (req.body ?? {}) as Record<string, unknown>;
  addAvis(req.session.uid, Number(note), String(commentaire));
  res.json({ message: 'Merci pour votre note !' });
});
