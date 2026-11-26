import { Router, Request, Response } from 'express';
import {
  requireParishPermission,
  verifyCsrfForSessionMutation,
} from '../auth/auth.middleware.js';
import {
  INTENTION_TARIFFS,
  PAYMENT_PROVIDERS_META,
  PAYMENT_SCENARIO_LABELS,
  PAYMENT_SIMULATION_CONFIG,
  PAYMENT_STATUS_LABELS,
} from './payment.config.js';
import {
  getPaymentDetailsForStaff,
  getPublicPaymentByReference,
  listPaymentsFiltered,
  retrySimulatedPayment,
  simulateIntentionPayment,
} from './payments.service.js';
import { computePaymentStatistics } from './payments.stats.js';

export const paymentsApiRouter = Router();

paymentsApiRouter.use(verifyCsrfForSessionMutation);

paymentsApiRouter.get('/providers', (_req: Request, res: Response) => {
  res.json({
    simulationMode: PAYMENT_SIMULATION_CONFIG.simulationMode,
    currency: PAYMENT_SIMULATION_CONFIG.currency,
    providers: Object.values(PAYMENT_PROVIDERS_META),
    tariffs: INTENTION_TARIFFS,
    scenarios: PAYMENT_SCENARIO_LABELS,
  });
});

paymentsApiRouter.post('/simulate', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await simulateIntentionPayment({
    rawBody: body,
    intentionId: typeof body.intentionId === 'string' ? body.intentionId : undefined,
    intentionTrackingRef:
      typeof body.intentionTrackingRef === 'string'
        ? body.intentionTrackingRef
        : typeof body.trackingRef === 'string'
          ? body.trackingRef
          : undefined,
    provider: typeof body.provider === 'string' ? body.provider : undefined,
    faithfulPhone:
      typeof body.faithfulPhone === 'string'
        ? body.faithfulPhone
        : typeof body.phone === 'string'
          ? body.phone
          : undefined,
    amount:
      typeof body.amount === 'number' || typeof body.amount === 'string'
        ? body.amount
        : undefined,
    scenario: typeof body.scenario === 'string' ? body.scenario : 'SUCCESS',
    faithfulUserId: req.authContext?.user.id ?? null,
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.status(result.payment.status === 'SUCCESS' ? 201 : 200).json({
    success: true,
    simulationMode: true,
    operatorMessage: result.operatorMessage,
    steps: result.steps,
    payment: result.payment,
    events: result.events,
    intention: {
      id: result.intention.id,
      trackingRef: result.intention.trackingRef,
      parishName: result.intention.parishName,
      objet: result.intention.objet,
      status: result.intention.status,
    },
  });
});

paymentsApiRouter.post('/:id/retry', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await retrySimulatedPayment({
    rawBody: body,
    paymentId: String(req.params.id || ''),
    provider: typeof body.provider === 'string' ? body.provider : undefined,
    faithfulPhone:
      typeof body.faithfulPhone === 'string'
        ? body.faithfulPhone
        : typeof body.phone === 'string'
          ? body.phone
          : undefined,
    scenario: typeof body.scenario === 'string' ? body.scenario : 'SUCCESS',
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.status(201).json({
    success: true,
    simulationMode: true,
    operatorMessage: result.operatorMessage,
    steps: result.steps,
    payment: result.payment,
    events: result.events,
    intention: {
      id: result.intention.id,
      trackingRef: result.intention.trackingRef,
      parishName: result.intention.parishName,
      objet: result.intention.objet,
      status: result.intention.status,
    },
  });
});

paymentsApiRouter.get('/reference/:reference', async (req: Request, res: Response) => {
  const found = await getPublicPaymentByReference(String(req.params.reference || ''));
  if (!found) {
    res.status(404).json({ success: false, error: 'Aucune transaction trouvée pour cette référence.' });
    return;
  }
  res.json({ success: true, ...found });
});

paymentsApiRouter.get(
  '/statistics',
  requireParishPermission('parish.payments.statistics'),
  async (req: Request, res: Response) => {
    const parishId = req.authContext!.activeParish!.id;
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
    const stats = await computePaymentStatistics({ parishId, dateFrom, dateTo });
    res.json({
      success: true,
      parishId,
      parishName: req.authContext!.activeParish!.name,
      statistics: stats,
    });
  }
);

paymentsApiRouter.get(
  '/',
  requireParishPermission('parish.payments.view'),
  async (req: Request, res: Response) => {
    const parishId = req.authContext!.activeParish!.id;
    const result = await listPaymentsFiltered({
      parishId,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
      page: typeof req.query.page === 'string' ? Number(req.query.page) : 1,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 10,
    });
    res.json({
      success: true,
      parishId,
      statusLabels: PAYMENT_STATUS_LABELS,
      providers: PAYMENT_PROVIDERS_META,
      ...result,
    });
  }
);

paymentsApiRouter.get(
  '/:id',
  requireParishPermission('parish.payments.view'),
  async (req: Request, res: Response) => {
    const parishId = req.authContext!.activeParish!.id;
    const detail = await getPaymentDetailsForStaff(String(req.params.id || ''), parishId);
    if (!detail) {
      res.status(404).json({ success: false, error: 'Transaction introuvable dans cette paroisse.' });
      return;
    }
    res.json({ success: true, ...detail });
  }
);

paymentsApiRouter.patch(
  '/:id/status',
  requireParishPermission('parish.payments.view'),
  (_req: Request, res: Response) => {
    res.status(403).json({
      success: false,
      error:
        'Modification directe du statut d’un paiement interdite au niveau paroissial. Contactez le mécanisme de correction administrative.',
    });
  }
);
