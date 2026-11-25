import crypto from 'crypto';
import { getPlatformState, savePlatformState } from '../platform/platform.repository.js';
import type { MesseEntity } from '../platform/platform.types.js';
import { recordAuditLog } from '../audit/audit.service.js';

export function listMassesForParish(parishId: string): MesseEntity[] {
  return getPlatformState().messes.filter((m) => m.parishId === parishId);
}

export function createMesseForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  date: string;
  horaire: string;
  celebrant: string;
  type?: string;
}): { ok: true; messe: MesseEntity } | { ok: false; status: number; error: string } {
  const date = String(input.date || '').trim().slice(0, 40);
  const horaire = String(input.horaire || '').trim().slice(0, 40);
  const celebrant = String(input.celebrant || '').trim().slice(0, 120);

  if (!date || !horaire || !celebrant) {
    return { ok: false, status: 400, error: 'Date, horaire et célébrant sont obligatoires.' };
  }

  const state = getPlatformState();
  const messe: MesseEntity = {
    id: `messe-${crypto.randomUUID().slice(0, 10)}`,
    parishId: input.parishId,
    date,
    horaire,
    celebrant,
    type: String(input.type || 'Messe paroissiale').trim().slice(0, 80),
    statut: 'A venir',
    createdBy: input.actorUserId,
    createdAt: new Date().toISOString(),
  };

  state.messes.unshift(messe);
  savePlatformState(state);

  recordAuditLog({
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

export function updateMesseStatus(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  messeId: string;
  statut: MesseEntity['statut'];
}): { ok: true; messe: MesseEntity } | { ok: false; status: number; error: string } {
  const state = getPlatformState();
  const messe = state.messes.find((m) => m.id === input.messeId && m.parishId === input.parishId);
  if (!messe) {
    return { ok: false, status: 404, error: 'Messe introuvable dans cette paroisse.' };
  }

  messe.statut = input.statut;
  savePlatformState(state);

  recordAuditLog({
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
