import { Router, Request, Response } from 'express';
import {
  requireParishContext,
  requireParishPermission,
  verifyCsrfForSessionMutation,
} from '../auth/auth.middleware.js';
import {
  getPublicIntentionTracking,
  listIntentionsForParish,
  submitPublicIntention,
  transitionIntentionStatus,
} from './intentions.service.js';
import type { IntentionStatus, PermissionCode } from '../platform/platform.types.js';

export const intentionsPublicRouter = Router();
export const intentionsParishRouter = Router();

intentionsPublicRouter.post('/public', (req: Request, res: Response) => {
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
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.status(201).json({
    success: true,
    intentionId: result.intention.id,
    trackingRef: result.intention.trackingRef,
    parishName: result.intention.parishName,
    status: result.intention.status,
    amount: result.intention.amount,
    currency: result.intention.currency,
    paymentUrl: `/paiement/${result.intention.trackingRef}`,
  });
});

intentionsPublicRouter.get('/suivi/:ref', (req: Request, res: Response) => {
  const summary = getPublicIntentionTracking(String(req.params.ref || ''));
  if (!summary) {
    res.status(404).json({ success: false, error: 'Référence d’intention introuvable.' });
    return;
  }
  res.json({ success: true, tracking: summary });
});

intentionsParishRouter.use(requireParishContext);
intentionsParishRouter.use(verifyCsrfForSessionMutation);

intentionsParishRouter.get(
  '/',
  requireParishPermission('parish.intentions.view'),
  (req: Request, res: Response) => {
    const parishId = req.authContext!.activeParish!.id;
    const rows = listIntentionsForParish(parishId, {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      objet: typeof req.query.objet === 'string' ? req.query.objet : undefined,
      requester: typeof req.query.requester === 'string' ? req.query.requester : undefined,
      messeId: typeof req.query.messeId === 'string' ? req.query.messeId : undefined,
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
    });

    res.json({ parishId, intentions: rows });
  }
);

function requiredPermissionForStatus(nextStatus: IntentionStatus): PermissionCode {
  if (nextStatus === 'CELEBRATED') return 'parish.intentions.celebrate';
  if (nextStatus === 'ACCEPTED' || nextStatus === 'REJECTED') return 'parish.intentions.approve';
  return 'parish.intentions.process';
}

intentionsParishRouter.patch('/:id/status', (req: Request, res: Response) => {
  const ctx = req.authContext!;
  const body = (req.body ?? {}) as Record<string, string>;
  const nextStatus = String(body.status || '').toUpperCase() as IntentionStatus;

  const validStatuses: IntentionStatus[] = [
    'PENDING',
    'PROCESSING',
    'ACCEPTED',
    'SCHEDULED',
    'CELEBRATED',
    'REJECTED',
    'CANCELLED',
  ];
  if (!validStatuses.includes(nextStatus)) {
    res.status(400).json({ success: false, error: 'Statut d’intention invalide.' });
    return;
  }

  const requiredPerm = requiredPermissionForStatus(nextStatus);
  // Also allow parish.intentions.approve if processing/cancelling when user is Curé
  const hasPerm =
    ctx.permissions.includes(requiredPerm) ||
    (nextStatus === 'CANCELLED' && ctx.permissions.includes('parish.intentions.approve'));

  if (!hasPerm) {
    res.status(403).json({
      success: false,
      error: `Permission requise (${requiredPerm}) pour passer au statut ${nextStatus}.`,
    });
    return;
  }

  const result = transitionIntentionStatus({
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    parishId: ctx.activeParish!.id,
    intentionId: String(req.params.id || ''),
    nextStatus,
    internalComment: body.internalComment,
    messeId: body.messeId || null,
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, intention: result.intention });
});
