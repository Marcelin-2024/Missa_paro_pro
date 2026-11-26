import crypto from 'crypto';
import type {
  IntentionEntity,
  PaymentEntity,
  PaymentEventEntity,
  PaymentEventType,
  PaymentProviderCode,
  PaymentScenario,
  PaymentStatus,
} from '../platform/platform.types.js';
import {
  PAYMENT_PROVIDERS_META,
  PAYMENT_SIMULATION_CONFIG,
  PAYMENT_STATUS_LABELS,
  resolveIntentionTariff,
} from './payment.config.js';
import { getPaymentProvider, isValidPaymentProvider } from './providers/provider.registry.js';
import type { PaymentSimulationStep } from './providers/payment-provider.interface.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import {
  findIntentionByIdRepo,
  findIntentionByTrackingRefRepo,
} from '../../repositories/intentions.repository.js';
import { findParishByIdRepo } from '../../repositories/parishes.repository.js';
import {
  commitPaymentCorrectionTransaction,
  commitSimulatedPaymentTransaction,
  findPaymentByIdOrRefRepo,
  listPaymentEventsByPaymentRepo,
  listPaymentsByIntentionRepo,
  listPaymentsByIntentionTrackingRefRepo,
  listPaymentsRepo,
} from '../../repositories/payments.repository.js';

const FORBIDDEN_SENSITIVE_KEYS = [
  'pin',
  'pinCode',
  'codePin',
  'password',
  'motdepasse',
  'otp',
  'cvv',
  'secret',
];

const activeIntentionLocks = new Set<string>();

function generateTransactionReference(): string {
  const year = new Date().getFullYear();
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TXN-${year}-${token}`;
}

export function normalizeMobileMoneyPhone(rawPhone: string): string | null {
  const cleaned = String(rawPhone || '').trim().replace(/[\s().-]+/g, '');
  if (!cleaned) return null;
  if (!/^\+?\d{8,15}$/.test(cleaned)) {
    return null;
  }
  return String(rawPhone).trim().slice(0, 40);
}

function hasForbiddenSensitiveFields(rawBody: Record<string, unknown> | undefined): boolean {
  if (!rawBody || typeof rawBody !== 'object') return false;
  return Object.keys(rawBody).some((key) => FORBIDDEN_SENSITIVE_KEYS.includes(key.trim()));
}

function resolveScenario(rawScenario: unknown): PaymentScenario | null {
  const upper = String(rawScenario || 'SUCCESS').trim().toUpperCase();
  if (['SUCCESS', 'FAILED', 'CANCELLED', 'PENDING'].includes(upper)) {
    return upper as PaymentScenario;
  }
  return null;
}

function buildPaymentEvent(input: {
  paymentId: string;
  parishId: string;
  eventType: PaymentEventType;
  previousStatus: PaymentStatus | null;
  newStatus: PaymentStatus;
  description: string;
}): PaymentEventEntity {
  return {
    id: `pevt-${crypto.randomUUID().slice(0, 12)}`,
    paymentId: input.paymentId,
    parishId: input.parishId,
    eventType: input.eventType,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    description: input.description.slice(0, 300),
    createdAt: new Date().toISOString(),
  };
}

async function executeSimulatedTransaction(params: {
  intention: IntentionEntity;
  providerCode: PaymentProviderCode;
  phone: string;
  amount: number;
  scenario: PaymentScenario;
  faithfulUserId?: string | null;
  isRetry: boolean;
  supersededPendingPaymentId?: string;
}): Promise<
  | {
      ok: true;
      payment: PaymentEntity;
      events: PaymentEventEntity[];
      steps: PaymentSimulationStep[];
      operatorMessage: string;
    }
  | { ok: false; status: number; error: string }
> {
  const provider = getPaymentProvider(params.providerCode);
  let capturedSteps: PaymentSimulationStep[] = [];
  let capturedMessage = '';

  const supersededCancelEvent = params.supersededPendingPaymentId
    ? buildPaymentEvent({
        paymentId: params.supersededPendingPaymentId,
        parishId: params.intention.parishId,
        eventType: 'PAYMENT_CANCELLED',
        previousStatus: 'PENDING',
        newStatus: 'CANCELLED',
        description: 'Tentative précédente clôturée avant relance.',
      })
    : undefined;

  const txResult = await commitSimulatedPaymentTransaction({
    intentionId: params.intention.id,
    isRetry: params.isRetry,
    supersededPendingPaymentId: params.supersededPendingPaymentId,
    supersededCancelEvent,
    buildRecord: (attemptNumber) => {
      const transactionReference = generateTransactionReference();
      const now = new Date().toISOString();
      const paymentId = `pay-${crypto.randomUUID().slice(0, 12)}`;

      const simResult = provider.simulatePayment({
        paymentId,
        transactionReference,
        intentionId: params.intention.id,
        parishId: params.intention.parishId,
        amount: params.amount,
        currency: 'XOF',
        phone: params.phone,
        scenario: params.scenario,
        attemptNumber,
      });

      capturedSteps = simResult.steps;
      capturedMessage = simResult.operatorMessage;

      const record: PaymentEntity = {
        id: paymentId,
        transactionReference,
        intentionId: params.intention.id,
        intentionTrackingRef: params.intention.trackingRef,
        parishId: params.intention.parishId,
        parishName: params.intention.parishName,
        faithfulUserId: params.faithfulUserId ?? params.intention.requesterUserId ?? null,
        faithfulName: params.intention.requesterName,
        faithfulPhone: params.phone,
        provider: params.providerCode,
        amount: params.amount,
        currency: 'XOF',
        status: simResult.status,
        simulationMode: true,
        scenario: params.scenario,
        createdAt: now,
        updatedAt: new Date().toISOString(),
        confirmedAt: simResult.confirmedAt,
        failureReason: simResult.failureReason,
        attemptNumber,
      };

      const finalEventType: PaymentEventType =
        simResult.status === 'SUCCESS'
          ? 'PAYMENT_CONFIRMED'
          : simResult.status === 'FAILED'
            ? 'PAYMENT_FAILED'
            : simResult.status === 'CANCELLED'
              ? 'PAYMENT_CANCELLED'
              : 'PAYMENT_PENDING';

      const events: PaymentEventEntity[] = [
        buildPaymentEvent({
          paymentId: record.id,
          parishId: record.parishId,
          eventType: params.isRetry ? 'RETRY_INITIATED' : 'CREATED',
          previousStatus: null,
          newStatus: 'PENDING',
          description: `${params.isRetry ? 'Nouvelle tentative' : 'Transaction simulée'} #${attemptNumber} initialisée via ${provider.displayName} pour ${params.intention.trackingRef}.`,
        }),
        buildPaymentEvent({
          paymentId: record.id,
          parishId: record.parishId,
          eventType: 'OPERATOR_REQUEST_SENT',
          previousStatus: 'PENDING',
          newStatus: 'PENDING',
          description: `Demande simulée transmise localement à l’adaptateur ${provider.displayName} (${params.phone}).`,
        }),
        buildPaymentEvent({
          paymentId: record.id,
          parishId: record.parishId,
          eventType: finalEventType,
          previousStatus: 'PENDING',
          newStatus: simResult.status,
          description: simResult.operatorMessage,
        }),
      ];

      return { payment: record, events };
    },
  });

  if (!txResult.ok) return txResult;

  const { payment, events } = txResult;

  if (payment.status === 'SUCCESS') {
    await recordAuditLog({
      actorUserId: payment.faithfulUserId,
      actorEmail: params.intention.requesterEmail || 'fidele@public.ci',
      scope: 'PARISH',
      parishId: payment.parishId,
      action: 'PAYMENT_SIMULATED_SUCCESS',
      targetType: 'PAYMENT',
      targetId: payment.id,
      summary: `Paiement simulé réussi (${payment.amount} XOF · ${provider.displayName}) pour ${payment.intentionTrackingRef} [${payment.transactionReference}].`,
    });

    await createNotification({
      parishId: payment.parishId,
      trackingRef: payment.intentionTrackingRef,
      audience: 'PARISH_ADMIN',
      type: 'PAYMENT_SIMULATED_RECEIVED',
      title: 'Offrande simulée reçue',
      message: `${payment.faithfulName} a simulé un paiement ${provider.displayName} de ${payment.amount} XOF pour l’intention ${payment.intentionTrackingRef}.`,
    });

    await createNotification({
      userId: payment.faithfulUserId,
      parishId: payment.parishId,
      trackingRef: payment.intentionTrackingRef,
      audience: 'FIDELE',
      type: 'PAYMENT_SIMULATED_CONFIRMED',
      title: 'Paiement simulé confirmé',
      message: `Transaction simulée ${payment.transactionReference} (${payment.amount} XOF via ${provider.displayName}) confirmée pour ${payment.intentionTrackingRef}.`,
    });
  }

  return {
    ok: true,
    payment,
    events,
    steps: capturedSteps,
    operatorMessage: capturedMessage,
  };
}

export async function simulateIntentionPayment(input: {
  rawBody?: Record<string, unknown>;
  intentionId?: string;
  intentionTrackingRef?: string;
  provider?: string;
  faithfulPhone?: string;
  amount?: number | string;
  scenario?: string;
  faithfulUserId?: string | null;
}): Promise<
  | {
      ok: true;
      payment: PaymentEntity;
      events: PaymentEventEntity[];
      steps: PaymentSimulationStep[];
      operatorMessage: string;
      intention: IntentionEntity;
    }
  | { ok: false; status: number; error: string }
> {
  if (hasForbiddenSensitiveFields(input.rawBody)) {
    return {
      ok: false,
      status: 400,
      error: 'Aucun code PIN, mot de passe opérateur ou donnée bancaire sensible ne doit être transmis.',
    };
  }

  const providerUpper = String(input.provider || '').trim().toUpperCase();
  if (!isValidPaymentProvider(providerUpper)) {
    return {
      ok: false,
      status: 400,
      error: 'Opérateur Mobile Money invalide. Choisissez Wave, Orange Money, MTN Money ou Moov Money.',
    };
  }

  const cleanPhone = normalizeMobileMoneyPhone(input.faithfulPhone || '');
  if (!cleanPhone) {
    return {
      ok: false,
      status: 400,
      error: 'Numéro de téléphone Mobile Money invalide (8 à 15 chiffres attendus).',
    };
  }

  const scenario = resolveScenario(input.scenario);
  if (!scenario) {
    return { ok: false, status: 400, error: 'Scénario de simulation invalide.' };
  }

  const idLookup = String(input.intentionId || '').trim();
  const refLookup = String(input.intentionTrackingRef || '').trim().toUpperCase();
  const intention =
    (idLookup ? await findIntentionByIdRepo(idLookup) : null) ||
    (refLookup ? await findIntentionByTrackingRefRepo(refLookup) : null);

  if (!intention) {
    return { ok: false, status: 404, error: 'Intention de messe introuvable.' };
  }

  if (intention.status === 'REJECTED' || intention.status === 'CANCELLED') {
    return {
      ok: false,
      status: 400,
      error: 'Impossible de payer une intention refusée ou annulée.',
    };
  }

  if (activeIntentionLocks.has(intention.id)) {
    return {
      ok: false,
      status: 409,
      error: 'Un traitement de paiement est déjà en cours pour cette intention.',
    };
  }

  activeIntentionLocks.add(intention.id);
  try {
    const expectedAmount =
      typeof intention.amount === 'number' && intention.amount > 0
        ? intention.amount
        : resolveIntentionTariff(intention.intentionType, intention.objet).amount;
    const requestedAmount =
      input.amount !== undefined && input.amount !== '' ? Number(input.amount) : expectedAmount;

    if (
      !Number.isFinite(requestedAmount) ||
      !Number.isInteger(requestedAmount) ||
      requestedAmount < PAYMENT_SIMULATION_CONFIG.minAmountXof ||
      requestedAmount > PAYMENT_SIMULATION_CONFIG.maxAmountXof
    ) {
      return {
        ok: false,
        status: 400,
        error: `Le montant doit être un entier compris entre ${PAYMENT_SIMULATION_CONFIG.minAmountXof} et ${PAYMENT_SIMULATION_CONFIG.maxAmountXof} XOF.`,
      };
    }

    if (requestedAmount !== expectedAmount) {
      return {
        ok: false,
        status: 400,
        error: `Montant incohérent : le montant attendu pour cette intention est de ${expectedAmount} XOF.`,
      };
    }

    const execution = await executeSimulatedTransaction({
      intention,
      providerCode: providerUpper,
      phone: cleanPhone,
      amount: expectedAmount,
      scenario,
      faithfulUserId: input.faithfulUserId,
      isRetry: false,
    });

    if (!execution.ok) return execution;

    return {
      ...execution,
      intention,
    };
  } finally {
    activeIntentionLocks.delete(intention.id);
  }
}

export async function retrySimulatedPayment(input: {
  rawBody?: Record<string, unknown>;
  paymentId: string;
  provider?: string;
  faithfulPhone?: string;
  scenario?: string;
}): Promise<
  | {
      ok: true;
      payment: PaymentEntity;
      events: PaymentEventEntity[];
      steps: PaymentSimulationStep[];
      operatorMessage: string;
      intention: IntentionEntity;
    }
  | { ok: false; status: number; error: string }
> {
  if (hasForbiddenSensitiveFields(input.rawBody)) {
    return {
      ok: false,
      status: 400,
      error: 'Aucun code PIN ou donnée bancaire sensible ne doit être transmis.',
    };
  }

  const previousPayment = await findPaymentByIdOrRefRepo(input.paymentId);
  if (!previousPayment) {
    return { ok: false, status: 404, error: 'Transaction introuvable.' };
  }

  const intention = await findIntentionByIdRepo(previousPayment.intentionId);
  if (!intention) {
    return { ok: false, status: 404, error: 'Intention associée introuvable.' };
  }

  if (activeIntentionLocks.has(intention.id)) {
    return {
      ok: false,
      status: 409,
      error: 'Un paiement est déjà en cours pour cette intention.',
    };
  }

  activeIntentionLocks.add(intention.id);
  try {
    if (previousPayment.status === 'SUCCESS') {
      return {
        ok: false,
        status: 409,
        error: 'Cette intention est déjà payée. Impossible de relancer une facturation.',
      };
    }

    if (!['FAILED', 'CANCELLED', 'EXPIRED', 'PENDING'].includes(previousPayment.status)) {
      return {
        ok: false,
        status: 400,
        error: 'Cette transaction ne peut pas être relancée.',
      };
    }

    const providerCandidate = input.provider
      ? String(input.provider).trim().toUpperCase()
      : previousPayment.provider;
    if (!isValidPaymentProvider(providerCandidate)) {
      return { ok: false, status: 400, error: 'Opérateur Mobile Money invalide.' };
    }

    const cleanPhone = normalizeMobileMoneyPhone(input.faithfulPhone || previousPayment.faithfulPhone);
    if (!cleanPhone) {
      return { ok: false, status: 400, error: 'Numéro Mobile Money invalide.' };
    }

    const scenario = resolveScenario(input.scenario || 'SUCCESS');
    if (!scenario) {
      return { ok: false, status: 400, error: 'Scénario de simulation invalide.' };
    }

    const execution = await executeSimulatedTransaction({
      intention,
      providerCode: providerCandidate,
      phone: cleanPhone,
      amount: previousPayment.amount,
      scenario,
      faithfulUserId: previousPayment.faithfulUserId,
      isRetry: true,
      supersededPendingPaymentId:
        previousPayment.status === 'PENDING' ? previousPayment.id : undefined,
    });

    if (!execution.ok) return execution;

    return {
      ...execution,
      intention,
    };
  } finally {
    activeIntentionLocks.delete(intention.id);
  }
}

export async function listPaymentsFiltered(filters: {
  parishId?: string;
  q?: string;
  provider?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}) {
  let rows = await listPaymentsRepo(filters.parishId);

  if (filters.provider && isValidPaymentProvider(filters.provider)) {
    const provUpper = filters.provider.trim().toUpperCase();
    rows = rows.filter((p) => p.provider === provUpper);
  }

  if (filters.status) {
    const statusUpper = filters.status.trim().toUpperCase();
    rows = rows.filter((p) => p.status === statusUpper);
  }

  if (filters.dateFrom) {
    const fromIso = filters.dateFrom.trim();
    rows = rows.filter((p) => p.createdAt.slice(0, 10) >= fromIso);
  }

  if (filters.dateTo) {
    const toIso = filters.dateTo.trim();
    rows = rows.filter((p) => p.createdAt.slice(0, 10) <= toIso);
  }

  if (filters.q && filters.q.trim()) {
    const q = filters.q.trim().toLowerCase();
    rows = rows.filter(
      (p) =>
        p.faithfulName.toLowerCase().includes(q) ||
        p.faithfulPhone.toLowerCase().includes(q) ||
        p.transactionReference.toLowerCase().includes(q) ||
        p.intentionTrackingRef.toLowerCase().includes(q) ||
        p.parishName.toLowerCase().includes(q)
    );
  }

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const limit = Math.max(1, Math.min(50, Number(filters.limit) || 10));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.max(1, Math.min(totalPages, Number(filters.page) || 1));
  const start = (page - 1) * limit;

  return {
    items: rows.slice(start, start + limit),
    total,
    page,
    limit,
    totalPages,
  };
}

export async function getPaymentDetailsForStaff(
  paymentId: string,
  scopeParishId?: string | null
) {
  const payment = await findPaymentByIdOrRefRepo(paymentId);
  if (!payment) return null;
  if (scopeParishId && payment.parishId !== scopeParishId) return null;

  const [intention, parish, events] = await Promise.all([
    findIntentionByIdRepo(payment.intentionId),
    findParishByIdRepo(payment.parishId),
    listPaymentEventsByPaymentRepo(payment.id),
  ]);

  return {
    payment,
    intention: intention
      ? {
          id: intention.id,
          trackingRef: intention.trackingRef,
          objet: intention.objet,
          details: intention.details,
          status: intention.status,
          desiredDate: intention.desiredDate,
          amount: intention.amount ?? payment.amount,
          requestedAt: intention.requestedAt,
        }
      : null,
    parish: parish
      ? {
          id: parish.id,
          name: parish.name,
          dioceseName: parish.dioceseName,
          location: parish.location,
        }
      : { id: payment.parishId, name: payment.parishName, dioceseName: '', location: '' },
    events,
    providerMeta: PAYMENT_PROVIDERS_META[payment.provider],
    statusLabel: PAYMENT_STATUS_LABELS[payment.status],
  };
}

export async function getPublicPaymentByReference(reference: string) {
  const clean = String(reference || '').trim().toUpperCase();
  if (!clean) return null;

  const byTxn = await findPaymentByIdOrRefRepo(clean);
  let payment = byTxn;
  if (!payment) {
    const byIntention = await listPaymentsByIntentionTrackingRefRepo(clean);
    payment = byIntention[0] ?? null;
  }
  if (!payment) return null;

  const [intention, events] = await Promise.all([
    findIntentionByIdRepo(payment.intentionId),
    listPaymentEventsByPaymentRepo(payment.id),
  ]);

  return {
    payment,
    providerMeta: PAYMENT_PROVIDERS_META[payment.provider],
    statusLabel: PAYMENT_STATUS_LABELS[payment.status],
    intention: intention
      ? {
          id: intention.id,
          trackingRef: intention.trackingRef,
          parishId: intention.parishId,
          parishName: intention.parishName,
          objet: intention.objet,
          status: intention.status,
          amount: intention.amount ?? payment.amount,
        }
      : null,
    events,
  };
}

export async function getLatestPaymentForIntention(
  intentionId: string
): Promise<PaymentEntity | null> {
  const matches = await listPaymentsByIntentionRepo(intentionId);
  matches.sort((a, b) => {
    if (a.status === 'SUCCESS' && b.status !== 'SUCCESS') return -1;
    if (b.status === 'SUCCESS' && a.status !== 'SUCCESS') return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return matches[0] || null;
}

export async function applyExceptionalPaymentCorrection(input: {
  actorUserId: string;
  actorEmail: string;
  paymentId: string;
  nextStatus: PaymentStatus;
  reason: string;
}): Promise<{ ok: true; payment: PaymentEntity } | { ok: false; status: number; error: string }> {
  const cleanReason = String(input.reason || '').trim();
  if (cleanReason.length < 10) {
    return {
      ok: false,
      status: 400,
      error: 'Une justification administrative détaillée (min. 10 caractères) est obligatoire.',
    };
  }

  const payment = await findPaymentByIdOrRefRepo(input.paymentId);
  if (!payment) {
    return { ok: false, status: 404, error: 'Transaction introuvable.' };
  }

  if (!['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(input.nextStatus)) {
    return { ok: false, status: 400, error: 'Statut cible invalide.' };
  }

  const previousStatus = payment.status;
  if (previousStatus === input.nextStatus) {
    return { ok: false, status: 400, error: 'Le statut demandé est identique au statut actuel.' };
  }

  const now = new Date().toISOString();
  payment.status = input.nextStatus;
  payment.updatedAt = now;
  if (input.nextStatus === 'SUCCESS' && !payment.confirmedAt) {
    payment.confirmedAt = now;
  }
  if (input.nextStatus === 'FAILED' || input.nextStatus === 'CANCELLED') {
    payment.failureReason = cleanReason;
  }

  const event = buildPaymentEvent({
    paymentId: payment.id,
    parishId: payment.parishId,
    eventType: 'EXCEPTIONAL_CORRECTION',
    previousStatus,
    newStatus: input.nextStatus,
    description: `Correction administrative exceptionnelle par ${input.actorEmail} : ${cleanReason}`,
  });

  await commitPaymentCorrectionTransaction(payment, event);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'GLOBAL',
    parishId: payment.parishId,
    action: 'PAYMENT_EXCEPTIONAL_CORRECTION',
    targetType: 'PAYMENT',
    targetId: payment.id,
    summary: `Correction exceptionnelle ${payment.transactionReference} : ${previousStatus} → ${input.nextStatus} (${cleanReason}).`,
  });

  return { ok: true, payment };
}
