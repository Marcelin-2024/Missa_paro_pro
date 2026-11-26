import crypto from 'crypto';
import type { MesseEntity } from '../platform/platform.types.js';
import { recordAuditLog } from '../audit/audit.service.js';
import {
  deleteMesseRepo,
  findMesseByIdRepo,
  listMessesByParishRepo,
  saveMesseRepo,
} from '../../repositories/massesAnnouncements.repository.js';
import { listIntentionsByParishRepo } from '../../repositories/intentions.repository.js';
import { findUserById } from '../../repositories/users.repository.js';

export const ALLOWED_MESSE_TYPES = [
  'Messe paroissiale',
  'Messe dominicale',
  'Messe d’action de grâce',
  'Messe de requiem',
  'Messe matinale',
  'Solennité / Fête',
] as const;

export async function listMassesForParish(parishId: string): Promise<MesseEntity[]> {
  return listMessesByParishRepo(parishId);
}

export async function getMesseDetailsForParish(parishId: string, messeId: string) {
  const messe = await findMesseByIdRepo(messeId);
  if (!messe || messe.parishId !== parishId) return null;

  const [parishIntentions, creator] = await Promise.all([
    listIntentionsByParishRepo(parishId),
    findUserById(messe.createdBy),
  ]);

  const linkedIntentions = parishIntentions
    .filter((i) => i.messeId === messe.id)
    .map((i) => ({
      id: i.id,
      trackingRef: i.trackingRef,
      requesterName: i.requesterName,
      objet: i.objet,
      status: i.status,
    }));

  return {
    messe: {
      ...messe,
      lieu: messe.lieu || 'Église paroissiale',
    },
    createdByName: creator ? creator.displayName : 'Secrétariat paroissial',
    intentionsCount: linkedIntentions.length,
    linkedIntentions,
  };
}

export async function createMesseForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  date: string;
  horaire: string;
  celebrant: string;
  type?: string;
  lieu?: string;
}): Promise<{ ok: true; messe: MesseEntity } | { ok: false; status: number; error: string }> {
  const date = String(input.date || '').trim().slice(0, 40);
  const horaire = String(input.horaire || '').trim().slice(0, 40);
  const celebrant = String(input.celebrant || '').trim().slice(0, 120);
  const cleanType =
    String(input.type || 'Messe paroissiale').trim().slice(0, 80) || 'Messe paroissiale';
  const cleanLieu = String(input.lieu || '').trim().slice(0, 120) || 'Église paroissiale';

  if (!date || !horaire || !celebrant) {
    return { ok: false, status: 400, error: 'Date, horaire et célébrant sont obligatoires.' };
  }

  const now = new Date().toISOString();
  const messe: MesseEntity = {
    id: `messe-${crypto.randomUUID().slice(0, 10)}`,
    parishId: input.parishId,
    date,
    horaire,
    celebrant,
    type: cleanType,
    lieu: cleanLieu,
    statut: 'A venir',
    createdBy: input.actorUserId,
    createdAt: now,
    updatedAt: now,
  };

  await saveMesseRepo(messe);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'MESSE_CREATED',
    targetType: 'MESSE',
    targetId: messe.id,
    summary: `Programmation d’une messe le ${messe.date} (${messe.horaire}) par ${messe.celebrant}.`,
  });

  return { ok: true, messe };
}

export async function updateMesseForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  messeId: string;
  date: string;
  horaire: string;
  celebrant: string;
  type?: string;
  lieu?: string;
  statut?: MesseEntity['statut'];
}): Promise<{ ok: true; messe: MesseEntity } | { ok: false; status: number; error: string }> {
  const date = String(input.date || '').trim().slice(0, 40);
  const horaire = String(input.horaire || '').trim().slice(0, 40);
  const celebrant = String(input.celebrant || '').trim().slice(0, 120);

  if (!date || !horaire || !celebrant) {
    return { ok: false, status: 400, error: 'Date, horaire et célébrant sont obligatoires.' };
  }

  const messe = await findMesseByIdRepo(input.messeId);
  if (!messe || messe.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Messe introuvable dans cette paroisse.' };
  }

  if (input.statut && !['A venir', 'Passée', 'Annulée'].includes(input.statut)) {
    return { ok: false, status: 400, error: 'Statut de messe invalide.' };
  }

  messe.date = date;
  messe.horaire = horaire;
  messe.celebrant = celebrant;
  if (typeof input.type === 'string' && input.type.trim()) {
    messe.type = input.type.trim().slice(0, 80);
  }
  if (typeof input.lieu === 'string') {
    messe.lieu = input.lieu.trim().slice(0, 120) || 'Église paroissiale';
  }
  if (input.statut) {
    messe.statut = input.statut;
  }
  messe.updatedAt = new Date().toISOString();
  await saveMesseRepo(messe);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'MESSE_UPDATED',
    targetType: 'MESSE',
    targetId: messe.id,
    summary: `Modification de la messe ${messe.date} (${messe.horaire}) — ${messe.celebrant}.`,
  });

  return { ok: true, messe };
}

export async function updateMesseStatus(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  messeId: string;
  statut: MesseEntity['statut'];
}): Promise<{ ok: true; messe: MesseEntity } | { ok: false; status: number; error: string }> {
  const messe = await findMesseByIdRepo(input.messeId);
  if (!messe || messe.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Messe introuvable dans cette paroisse.' };
  }

  messe.statut = input.statut;
  messe.updatedAt = new Date().toISOString();
  await saveMesseRepo(messe);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'MESSE_STATUS_UPDATED',
    targetType: 'MESSE',
    targetId: messe.id,
    summary: `Statut de la messe ${messe.date} (${messe.horaire}) mis à jour : ${messe.statut}.`,
  });

  return { ok: true, messe };
}

export async function deleteMesseForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  messeId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const messe = await findMesseByIdRepo(input.messeId);
  if (!messe || messe.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Messe introuvable dans cette paroisse.' };
  }

  const parishIntentions = await listIntentionsByParishRepo(input.parishId);
  const activeLinked = parishIntentions.filter(
    (i) => i.messeId === input.messeId && !['CANCELLED', 'REJECTED'].includes(i.status)
  );
  if (activeLinked.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Impossible de supprimer : ${activeLinked.length} intention(s) active(s) y sont rattachée(s). Annulez plutôt la messe.`,
    };
  }

  await deleteMesseRepo(messe.id);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'MESSE_DELETED',
    targetType: 'MESSE',
    targetId: messe.id,
    summary: `Suppression de la messe ${messe.date} (${messe.horaire}).`,
  });

  return { ok: true };
}
