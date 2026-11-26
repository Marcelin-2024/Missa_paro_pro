import { Router, Request, Response } from 'express';
import {
  requireParishContext,
  requireParishPermission,
  verifyCsrfForSessionMutation,
} from '../auth/auth.middleware.js';
import {
  getIntentionDetailsForParish,
  getPublicIntentionTracking,
  listEnrichedIntentionsForParish,
  submitPublicIntention,
  transitionIntentionStatus,
  updateIntentionDetailsByParish,
} from './intentions.service.js';
import type { IntentionStatus, PermissionCode } from '../platform/platform.types.js';

export const intentionsPublicRouter = Router();
export const intentionsParishRouter = Router();

intentionsPublicRouter.post('/public', async (req: Request, res: Response) => {
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

intentionsPublicRouter.get('/suivi/:ref', async (req: Request, res: Response) => {
  const summary = await getPublicIntentionTracking(String(req.params.ref || ''));
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
  async (req: Request, res: Response) => {
    const parishId = req.authContext!.activeParish!.id;
    let rows = await listEnrichedIntentionsForParish(parishId);
    if (typeof req.query.status === 'string' && req.query.status) {
      rows = rows.filter((r) => r.status === req.query.status);
    }
    if (typeof req.query.messeId === 'string' && req.query.messeId) {
      rows = rows.filter((r) => r.messeId === req.query.messeId);
    }

    res.json({ parishId, intentions: rows });
  }
);

intentionsParishRouter.get(
  '/:id',
  requireParishPermission('parish.intentions.view'),
  async (req: Request, res: Response) => {
    const detail = await getIntentionDetailsForParish(
      req.authContext!.activeParish!.id,
      String(req.params.id || '')
    );
    if (!detail) {
      res.status(404).json({ success: false, error: 'Intention introuvable.' });
      return;
    }
    res.json({ success: true, ...detail });
  }
);

intentionsParishRouter.patch('/:id', async (req: Request, res: Response) => {
  const ctx = req.authContext!;
  const canEdit =
    ctx.permissions.includes('parish.intentions.process') ||
    ctx.permissions.includes('parish.intentions.approve');
  if (!canEdit) {
    res
      .status(403)
      .json({ success: false, error: 'Permission insuffisante pour modifier cette intention.' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await updateIntentionDetailsByParish({
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    parishId: ctx.activeParish!.id,
    intentionId: String(req.params.id || ''),
    requesterName: typeof body.requesterName === 'string' ? body.requesterName : undefined,
    requesterPhone: typeof body.requesterPhone === 'string' ? body.requesterPhone : undefined,
    requesterEmail: typeof body.requesterEmail === 'string' ? body.requesterEmail : undefined,
    intentionType: typeof body.intentionType === 'string' ? body.intentionType : undefined,
    objet: typeof body.objet === 'string' ? body.objet : undefined,
    details: typeof body.details === 'string' ? body.details : undefined,
    desiredDate:
      body.desiredDate !== undefined ? (body.desiredDate ? String(body.desiredDate) : null) : undefined,
    messeId: body.messeId !== undefined ? (body.messeId ? String(body.messeId) : null) : undefined,
    internalComment: typeof body.internalComment === 'string' ? body.internalComment : undefined,
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, intention: result.intention });
});

function requiredPermissionForStatus(nextStatus: IntentionStatus): PermissionCode {
  if (nextStatus === 'CELEBRATED') return 'parish.intentions.celebrate';
  if (nextStatus === 'ACCEPTED' || nextStatus === 'REJECTED') return 'parish.intentions.approve';
  return 'parish.intentions.process';
}

intentionsParishRouter.patch('/:id/status', async (req: Request, res: Response) => {
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

  const result = await transitionIntentionStatus({
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
