import crypto from 'crypto';
import { getPlatformState, savePlatformState } from '../platform/platform.repository.js';
import type { IntentionEntity, IntentionStatus } from '../platform/platform.types.js';
import { ensureDirectoryParishTenant, getParishById } from '../parishes/parishes.service.js';
import { findParishById } from '../ecclesiastical/ecclesiastical.repository.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';

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

export function submitPublicIntention(input: {
  provinceId: string;
  dioceseId: string;
  parishId: string;
  requesterUserId?: string | null;
  requesterName: string;
  requesterPhone: string;
  requesterEmail?: string;
  objet: string;
  details: string;
  desiredDate?: string | null;
  messeId?: string | null;
}): { ok: true; intention: IntentionEntity } | { ok: false; status: number; error: string } {
  const cleanName = String(input.requesterName || '').trim().slice(0, 120);
  const cleanPhone = String(input.requesterPhone || '').trim().slice(0, 40);
  const cleanObjet = String(input.objet || '').trim().slice(0, 150);
  const cleanDetails = String(input.details || '').trim().slice(0, 1000);

  if (cleanName.length < 2 || cleanPhone.length < 6 || cleanObjet.length < 2 || cleanDetails.length < 3) {
    return {
      ok: false,
      status: 400,
      error: 'Veuillez renseigner votre nom, téléphone, objet et détail de l’intention.',
    };
  }

  let parish = getParishById(String(input.parishId || '').trim());
  if (!parish) {
    const dirMatch = findParishById(String(input.parishId || '').trim());
    if (
      dirMatch &&
      dirMatch.province.id === String(input.provinceId || '').trim() &&
      dirMatch.diocese.id === String(input.dioceseId || '').trim()
    ) {
      parish = ensureDirectoryParishTenant(dirMatch.parish.id) ?? undefined;
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

  const state = getPlatformState();
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

  state.intentions.unshift(record);
  savePlatformState(state);

  createNotification({
    parishId: parish.id,
    trackingRef: record.trackingRef,
    audience: 'PARISH_STAFF',
    type: 'INTENTION_RECEIVED',
    title: 'Nouvelle demande d’intention',
    message: `${record.objet} déposée par ${record.requesterName} (${record.trackingRef}).`,
  });

  createNotification({
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

export function listIntentionsForParish(
  parishId: string,
  filter?: {
    status?: string;
    objet?: string;
    requester?: string;
    messeId?: string;
    date?: string;
  }
): IntentionEntity[] {
  const state = getPlatformState();
  let rows = state.intentions.filter((item) => item.parishId === parishId);

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

export function transitionIntentionStatus(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  intentionId: string;
  nextStatus: IntentionStatus;
  internalComment?: string;
  messeId?: string | null;
}): { ok: true; intention: IntentionEntity } | { ok: false; status: number; error: string } {
  const state = getPlatformState();
  const intention = state.intentions.find(
    (item) => item.id === input.intentionId && item.parishId === input.parishId
  );
  if (!intention) {
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
    const validMesse = state.messes.find(
      (m) => m.id === chosenMesseId && m.parishId === input.parishId
    );
    if (!validMesse) {
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

  if (typeof input.internalComment === 'string' && input.internalComment.trim()) {
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

  savePlatformState(state);

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'INTENTION_STATUS_CHANGED',
    targetType: 'INTENTION',
    targetId: intention.id,
    summary: `Intention ${intention.trackingRef} : ${previousStatus} → ${input.nextStatus}.`,
  });

  // Never expose internalComment in faithful notifications!
  createNotification({
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

export function getPublicIntentionTracking(trackingRef: string) {
  const cleanRef = String(trackingRef || '').trim().toUpperCase();
  if (!cleanRef) return null;

  const state = getPlatformState();
  const item = state.intentions.find((i) => i.trackingRef.toUpperCase() === cleanRef);
  if (!item) return null;

  const linkedMesse = item.messeId
    ? state.messes.find((m) => m.id === item.messeId && m.parishId === item.parishId)
    : null;

  return {
    trackingRef: item.trackingRef,
    parishId: item.parishId,
    parishName: item.parishName,
    objet: item.objet,
    requestedAt: item.requestedAt,
    desiredDate: item.desiredDate,
    status: item.status,
    statusLabel: INTENTION_STATUS_LABELS[item.status],
    celebratedAt: item.celebratedAt,
    messe: linkedMesse
      ? { date: linkedMesse.date, horaire: linkedMesse.horaire, celebrant: linkedMesse.celebrant }
      : null,
  };
}
