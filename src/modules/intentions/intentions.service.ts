import crypto from 'crypto';
import type { IntentionEntity, IntentionStatus } from '../platform/platform.types.js';
import { ensureDirectoryParishTenant, getParishById } from '../parishes/parishes.service.js';
import { findParishById } from '../ecclesiastical/ecclesiastical.repository.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import {
  PAYMENT_PROVIDERS_META,
  PAYMENT_STATUS_LABELS,
  resolveIntentionTariff,
} from '../payments/payment.config.js';
import { getLatestPaymentForIntention } from '../payments/payments.service.js';
import {
  findIntentionByIdRepo,
  findIntentionByTrackingRefRepo,
  listIntentionsByParishRepo,
  saveIntentionRepo,
} from '../../repositories/intentions.repository.js';
import {
  findMesseByIdRepo,
  listMessesByParishRepo,
} from '../../repositories/massesAnnouncements.repository.js';
import { listPaymentsByIntentionRepo, listPaymentsRepo } from '../../repositories/payments.repository.js';
import { findUserById } from '../../repositories/users.repository.js';

export const ALLOWED_INTENTION_TRANSITIONS: Record<IntentionStatus, IntentionStatus[]> = {
  PENDING: ['PROCESSING', 'ACCEPTED', 'REJECTED', 'CANCELLED'],
  PROCESSING: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['SCHEDULED', 'REJECTED', 'CANCELLED'],
  SCHEDULED: ['CELEBRATED', 'CANCELLED'],
  CELEBRATED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const INTENTION_STATUS_LABELS: Record<IntentionStatus, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En traitement',
  ACCEPTED: 'Acceptée',
  SCHEDULED: 'Programmée',
  CELEBRATED: 'Célébrée',
  REJECTED: 'Refusée',
  CANCELLED: 'Annulée',
};

function generateTrackingRef(): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `INT-${year}-${suffix}`;
}

export async function submitPublicIntention(input: {
  provinceId: string;
  dioceseId: string;
  parishId: string;
  requesterUserId?: string | null;
  requesterName: string;
  requesterPhone: string;
  requesterEmail?: string;
  intentionType?: string;
  objet: string;
  details: string;
  desiredDate?: string | null;
  messeId?: string | null;
}): Promise<{ ok: true; intention: IntentionEntity } | { ok: false; status: number; error: string }> {
  const cleanName = String(input.requesterName || '').trim().slice(0, 120);
  const cleanPhone = String(input.requesterPhone || '').trim().slice(0, 40);
  const tariff = resolveIntentionTariff(input.intentionType, input.objet);
  const cleanObjet = String(input.objet || tariff.label || '').trim().slice(0, 150);
  const cleanDetails = String(input.details || '').trim().slice(0, 1000);

  if (cleanName.length < 2 || cleanPhone.length < 6 || cleanObjet.length < 2 || cleanDetails.length < 3) {
    return {
      ok: false,
      status: 400,
      error: 'Veuillez renseigner votre nom, téléphone, objet et détail de l’intention.',
    };
  }

  let parish = await getParishById(String(input.parishId || '').trim());
  if (!parish) {
    const dirMatch = findParishById(String(input.parishId || '').trim());
    if (
      dirMatch &&
      dirMatch.province.id === String(input.provinceId || '').trim() &&
      dirMatch.diocese.id === String(input.dioceseId || '').trim()
    ) {
      parish = (await ensureDirectoryParishTenant(dirMatch.parish.id)) ?? undefined;
    }
  }

  if (!parish) {
    return { ok: false, status: 404, error: 'Paroisse introuvable dans l’annuaire.' };
  }

  if (
    parish.provinceId !== String(input.provinceId || '').trim() ||
    parish.dioceseId !== String(input.dioceseId || '').trim()
  ) {
    return {
      ok: false,
      status: 400,
      error: 'La paroisse sélectionnée ne correspond pas à la province ou au diocèse choisi.',
    };
  }

  const now = new Date().toISOString();
  const record: IntentionEntity = {
    id: `int-${crypto.randomUUID().slice(0, 12)}`,
    trackingRef: generateTrackingRef(),
    parishId: parish.id,
    parishName: parish.name,
    provinceId: parish.provinceId,
    dioceseId: parish.dioceseId,
    requesterUserId: input.requesterUserId ?? null,
    requesterName: cleanName,
    requesterPhone: cleanPhone,
    requesterEmail: String(input.requesterEmail || '').trim().slice(0, 150),
    intentionType: tariff.code,
    amount: tariff.amount,
    currency: 'XOF',
    objet: cleanObjet,
    details: cleanDetails,
    requestedAt: now,
    desiredDate: input.desiredDate ? String(input.desiredDate).trim().slice(0, 40) : null,
    messeId: input.messeId ? String(input.messeId).trim().slice(0, 80) : null,
    status: 'PENDING',
    internalComment: '',
    processedAt: null,
    processedBy: null,
    celebratedAt: null,
    celebratedBy: null,
    updatedAt: now,
  };

  await saveIntentionRepo(record);

  await createNotification({
    parishId: parish.id,
    trackingRef: record.trackingRef,
    audience: 'PARISH_STAFF',
    type: 'INTENTION_RECEIVED',
    title: 'Nouvelle demande d’intention',
    message: `${record.objet} déposée par ${record.requesterName} (${record.trackingRef}).`,
  });

  await createNotification({
    userId: record.requesterUserId,
    parishId: parish.id,
    trackingRef: record.trackingRef,
    audience: 'FIDELE',
    type: 'INTENTION_SUBMITTED',
    title: 'Demande enregistrée',
    message: `Votre demande d’intention auprès de ${parish.name} a été enregistrée sous la référence ${record.trackingRef}.`,
  });

  return { ok: true, intention: record };
}

export async function listIntentionsForParish(
  parishId: string,
  filter?: {
    status?: string;
    objet?: string;
    requester?: string;
    messeId?: string;
    date?: string;
  }
): Promise<IntentionEntity[]> {
  let rows = await listIntentionsByParishRepo(parishId);

  if (filter?.status) {
    rows = rows.filter((item) => item.status === filter.status);
  }
  if (filter?.messeId) {
    rows = rows.filter((item) => item.messeId === filter.messeId);
  }
  if (filter?.date) {
    rows = rows.filter(
      (item) =>
        (item.desiredDate || '').includes(filter.date!) ||
        item.requestedAt.startsWith(filter.date!)
    );
  }
  if (filter?.objet) {
    const q = filter.objet.toLowerCase();
    rows = rows.filter((item) => item.objet.toLowerCase().includes(q));
  }
  if (filter?.requester) {
    const q = filter.requester.toLowerCase();
    rows = rows.filter((item) => item.requesterName.toLowerCase().includes(q));
  }

  return rows;
}

export async function transitionIntentionStatus(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  intentionId: string;
  nextStatus: IntentionStatus;
  internalComment?: string;
  messeId?: string | null;
}): Promise<{ ok: true; intention: IntentionEntity } | { ok: false; status: number; error: string }> {
  const intention = await findIntentionByIdRepo(input.intentionId);
  if (!intention || intention.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Intention introuvable dans cette paroisse.' };
  }

  const allowedNext = ALLOWED_INTENTION_TRANSITIONS[intention.status] || [];
  if (!allowedNext.includes(input.nextStatus)) {
    return {
      ok: false,
      status: 400,
      error: `Transition interdite : impossible de passer de ${INTENTION_STATUS_LABELS[intention.status]} à ${INTENTION_STATUS_LABELS[input.nextStatus] ?? input.nextStatus}.`,
    };
  }

  if (input.nextStatus === 'SCHEDULED') {
    const chosenMesseId = input.messeId ?? intention.messeId;
    if (!chosenMesseId) {
      return {
        ok: false,
        status: 400,
        error: 'Une messe associée est obligatoire pour programmer une intention.',
      };
    }
    const validMesse = await findMesseByIdRepo(chosenMesseId);
    if (!validMesse || validMesse.parishId !== input.parishId) {
      return {
        ok: false,
        status: 400,
        error: 'La messe sélectionnée n’appartient pas à cette paroisse.',
      };
    }
    intention.messeId = validMesse.id;
  }

  const now = new Date().toISOString();
  const previousStatus = intention.status;
  intention.status = input.nextStatus;
  intention.updatedAt = now;

  if (typeof input.internalComment === 'string') {
    intention.internalComment = input.internalComment.trim().slice(0, 500);
  }

  if (['PROCESSING', 'ACCEPTED', 'SCHEDULED', 'REJECTED', 'CANCELLED'].includes(input.nextStatus)) {
    intention.processedAt = now;
    intention.processedBy = input.actorUserId;
  }

  if (input.nextStatus === 'CELEBRATED') {
    intention.celebratedAt = now;
    intention.celebratedBy = input.actorUserId;
  }

  await saveIntentionRepo(intention);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'INTENTION_STATUS_CHANGED',
    targetType: 'INTENTION',
    targetId: intention.id,
    summary: `Intention ${intention.trackingRef} : ${previousStatus} → ${input.nextStatus}.`,
  });

  await createNotification({
    userId: intention.requesterUserId,
    parishId: intention.parishId,
    trackingRef: intention.trackingRef,
    audience: 'FIDELE',
    type: `INTENTION_${input.nextStatus}`,
    title: `Intention ${INTENTION_STATUS_LABELS[input.nextStatus]}`,
    message: `Votre demande ${intention.trackingRef} (${intention.parishName}) est passée au statut : ${INTENTION_STATUS_LABELS[input.nextStatus]}.`,
  });

  return { ok: true, intention };
}

export async function updateIntentionDetailsByParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  intentionId: string;
  requesterName?: string;
  requesterPhone?: string;
  requesterEmail?: string;
  intentionType?: string;
  objet?: string;
  details?: string;
  desiredDate?: string | null;
  messeId?: string | null;
  internalComment?: string;
}): Promise<{ ok: true; intention: IntentionEntity } | { ok: false; status: number; error: string }> {
  const intention = await findIntentionByIdRepo(input.intentionId);
  if (!intention || intention.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Intention introuvable dans cette paroisse.' };
  }

  if (['CELEBRATED', 'REJECTED', 'CANCELLED'].includes(intention.status)) {
    return {
      ok: false,
      status: 400,
      error: 'Une intention clôturée ne peut plus être modifiée.',
    };
  }

  if (typeof input.requesterName === 'string') {
    const cleanName = input.requesterName.trim().slice(0, 120);
    if (cleanName.length < 2) {
      return {
        ok: false,
        status: 400,
        error: 'Le nom du demandeur doit contenir au moins 2 caractères.',
      };
    }
    intention.requesterName = cleanName;
  }

  if (typeof input.requesterPhone === 'string') {
    const cleanPhone = input.requesterPhone.trim().slice(0, 40);
    if (cleanPhone.length < 6) {
      return { ok: false, status: 400, error: 'Numéro de téléphone invalide.' };
    }
    intention.requesterPhone = cleanPhone;
  }

  if (typeof input.requesterEmail === 'string') {
    intention.requesterEmail = input.requesterEmail.trim().slice(0, 150);
  }

  if (typeof input.objet === 'string') {
    const cleanObjet = input.objet.trim().slice(0, 150);
    if (cleanObjet.length < 2) {
      return { ok: false, status: 400, error: 'L’objet de l’intention est requis.' };
    }
    intention.objet = cleanObjet;
  }

  if (typeof input.details === 'string') {
    const cleanDetails = input.details.trim().slice(0, 1000);
    if (cleanDetails.length < 3) {
      return { ok: false, status: 400, error: 'Les précisions de prière sont requises.' };
    }
    intention.details = cleanDetails;
  }

  if (input.desiredDate !== undefined) {
    intention.desiredDate = input.desiredDate ? String(input.desiredDate).trim().slice(0, 40) : null;
  }

  if (typeof input.internalComment === 'string') {
    intention.internalComment = input.internalComment.trim().slice(0, 500);
  }

  if (typeof input.intentionType === 'string' && input.intentionType.trim()) {
    const tariff = resolveIntentionTariff(input.intentionType, intention.objet);
    intention.intentionType = tariff.code;
    const paymentsForIntention = await listPaymentsByIntentionRepo(intention.id);
    const hasPaidTx = paymentsForIntention.some((p) => p.status === 'SUCCESS');
    if (!hasPaidTx) {
      intention.amount = tariff.amount;
      intention.currency = 'XOF';
    }
  }

  if (input.messeId !== undefined) {
    const nextMesseId = input.messeId ? String(input.messeId).trim().slice(0, 80) : null;
    if (nextMesseId) {
      const validMesse = await findMesseByIdRepo(nextMesseId);
      if (!validMesse || validMesse.parishId !== input.parishId) {
        return {
          ok: false,
          status: 400,
          error: 'La messe sélectionnée n’appartient pas à cette paroisse.',
        };
      }
      intention.messeId = validMesse.id;
    } else if (intention.status !== 'SCHEDULED') {
      intention.messeId = null;
    }
  }

  intention.updatedAt = new Date().toISOString();
  await saveIntentionRepo(intention);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'INTENTION_UPDATED',
    targetType: 'INTENTION',
    targetId: intention.id,
    summary: `Mise à jour des informations de l’intention ${intention.trackingRef}.`,
  });

  return { ok: true, intention };
}

export async function getIntentionDetailsForParish(parishId: string, intentionId: string) {
  const item = await findIntentionByIdRepo(intentionId);
  if (!item || item.parishId !== parishId) return null;

  const tariff = resolveIntentionTariff(item.intentionType, item.objet);
  const [linkedMesse, latestPayment, processedByUser, celebratedByUser] = await Promise.all([
    item.messeId ? findMesseByIdRepo(item.messeId) : Promise.resolve(null),
    getLatestPaymentForIntention(item.id),
    item.processedBy ? findUserById(item.processedBy) : Promise.resolve(null),
    item.celebratedBy ? findUserById(item.celebratedBy) : Promise.resolve(null),
  ]);

  const validMesse = linkedMesse && linkedMesse.parishId === parishId ? linkedMesse : null;

  return {
    intention: item,
    statusLabel: INTENTION_STATUS_LABELS[item.status] || item.status,
    intentionTypeLabel: tariff.label,
    effectiveAmount:
      typeof item.amount === 'number' && item.amount > 0 ? item.amount : tariff.amount,
    currency: item.currency || 'XOF',
    processedByName: processedByUser ? processedByUser.displayName : null,
    celebratedByName: celebratedByUser ? celebratedByUser.displayName : null,
    messe: validMesse
      ? {
          id: validMesse.id,
          date: validMesse.date,
          horaire: validMesse.horaire,
          celebrant: validMesse.celebrant,
          type: validMesse.type || 'Messe paroissiale',
          lieu: validMesse.lieu || 'Église paroissiale',
        }
      : null,
    payment: latestPayment
      ? {
          id: latestPayment.id,
          transactionReference: latestPayment.transactionReference,
          provider: latestPayment.provider,
          providerName: PAYMENT_PROVIDERS_META[latestPayment.provider].name,
          amount: latestPayment.amount,
          currency: latestPayment.currency,
          status: latestPayment.status,
          statusLabel: PAYMENT_STATUS_LABELS[latestPayment.status],
          confirmedAt: latestPayment.confirmedAt,
          createdAt: latestPayment.createdAt,
        }
      : null,
  };
}

export async function listEnrichedIntentionsForParish(parishId: string) {
  const [rows, parishMesses, parishPayments] = await Promise.all([
    listIntentionsByParishRepo(parishId),
    listMessesByParishRepo(parishId),
    listPaymentsRepo(parishId),
  ]);

  const messeMap = new Map(parishMesses.map((m) => [m.id, m]));
  const paymentsByIntention = new Map<string, typeof parishPayments>();
  for (const pay of parishPayments) {
    const arr = paymentsByIntention.get(pay.intentionId) ?? [];
    arr.push(pay);
    paymentsByIntention.set(pay.intentionId, arr);
  }

  return rows.map((item) => {
    const tariff = resolveIntentionTariff(item.intentionType, item.objet);
    const linkedMesse = item.messeId ? messeMap.get(item.messeId) ?? null : null;
    const candidates = (paymentsByIntention.get(item.id) ?? []).sort((a, b) => {
      if (a.status === 'SUCCESS' && b.status !== 'SUCCESS') return -1;
      if (b.status === 'SUCCESS' && a.status !== 'SUCCESS') return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    const latestPayment = candidates[0] ?? null;

    return {
      ...item,
      intentionTypeLabel: tariff.label,
      effectiveAmount:
        typeof item.amount === 'number' && item.amount > 0 ? item.amount : tariff.amount,
      currency: item.currency || 'XOF',
      linkedMesse: linkedMesse
        ? {
            id: linkedMesse.id,
            date: linkedMesse.date,
            horaire: linkedMesse.horaire,
            celebrant: linkedMesse.celebrant,
          }
        : null,
      paymentSummary: latestPayment
        ? {
            status: latestPayment.status,
            statusLabel: PAYMENT_STATUS_LABELS[latestPayment.status],
            providerName: PAYMENT_PROVIDERS_META[latestPayment.provider].name,
            transactionReference: latestPayment.transactionReference,
          }
        : null,
    };
  });
}

export async function getPublicIntentionTracking(trackingRef: string) {
  const item = await findIntentionByTrackingRefRepo(trackingRef);
  if (!item) return null;

  const [linkedMesse, latestPayment] = await Promise.all([
    item.messeId ? findMesseByIdRepo(item.messeId) : Promise.resolve(null),
    getLatestPaymentForIntention(item.id),
  ]);

  const validMesse =
    linkedMesse && linkedMesse.parishId === item.parishId ? linkedMesse : null;

  const amount =
    typeof item.amount === 'number' && item.amount > 0
      ? item.amount
      : resolveIntentionTariff(item.intentionType, item.objet).amount;

  return {
    id: item.id,
    trackingRef: item.trackingRef,
    parishId: item.parishId,
    parishName: item.parishName,
    requesterName: item.requesterName,
    requesterPhone: item.requesterPhone,
    objet: item.objet,
    details: item.details,
    amount,
    currency: 'XOF' as const,
    requestedAt: item.requestedAt,
    desiredDate: item.desiredDate,
    status: item.status,
    statusLabel: INTENTION_STATUS_LABELS[item.status],
    celebratedAt: item.celebratedAt,
    messe: validMesse
      ? { date: validMesse.date, horaire: validMesse.horaire, celebrant: validMesse.celebrant }
      : null,
    payment: latestPayment
      ? {
          id: latestPayment.id,
          transactionReference: latestPayment.transactionReference,
          provider: latestPayment.provider,
          providerName: PAYMENT_PROVIDERS_META[latestPayment.provider].name,
          amount: latestPayment.amount,
          currency: latestPayment.currency,
          status: latestPayment.status,
          statusLabel: PAYMENT_STATUS_LABELS[latestPayment.status],
          simulationMode: latestPayment.simulationMode,
          confirmedAt: latestPayment.confirmedAt,
          createdAt: latestPayment.createdAt,
          attemptNumber: latestPayment.attemptNumber,
        }
      : null,
  };
}
