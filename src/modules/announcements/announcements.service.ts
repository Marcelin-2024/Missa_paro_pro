import crypto from 'crypto';
import { getPlatformState, savePlatformState } from '../platform/platform.repository.js';
import type { AnnonceEntity } from '../platform/platform.types.js';
import { recordAuditLog } from '../audit/audit.service.js';

export function listAnnouncementsForParish(parishId: string): AnnonceEntity[] {
  return getPlatformState().annonces.filter((a) => a.parishId === parishId);
}

export function createAnnouncementForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  type: AnnonceEntity['type'];
  titre: string;
  dateAnnonce: string;
  contenu: string;
  imageUrl?: string;
  canApproveDirectly: boolean;
}): { ok: true; annonce: AnnonceEntity } | { ok: false; status: number; error: string } {
  const titre = String(input.titre || '').trim().slice(0, 200);
  const contenu = String(input.contenu || '').trim().slice(0, 2000);
  const dateAnnonce = String(input.dateAnnonce || '').trim().slice(0, 40);

  if (!titre || !contenu || !dateAnnonce) {
    return { ok: false, status: 400, error: 'Titre, date et contenu de l’annonce requis.' };
  }

  const state = getPlatformState();
  const needsApproval =
    state.settings.requireCureAnnouncementApproval && !input.canApproveDirectly;

  const annonce: AnnonceEntity = {
    id: `ann-${crypto.randomUUID().slice(0, 10)}`,
    parishId: input.parishId,
    type: input.type,
    titre,
    dateAnnonce,
    contenu,
    imageUrl: input.imageUrl,
    statut: needsApproval ? 'PENDING_APPROVAL' : 'PUBLISHED',
    createdBy: input.actorUserId,
    approvedBy: needsApproval ? null : input.actorUserId,
    createdAt: new Date().toISOString(),
  };

  state.annonces.unshift(annonce);
  savePlatformState(state);

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'ANNOUNCEMENT_CREATED',
    targetType: 'ANNONCE',
    targetId: annonce.id,
    summary: `Annonce « ${annonce.titre} » (${annonce.statut}).`,
  });

  return { ok: true, annonce };
}

export function approveAnnouncementForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  annonceId: string;
}): { ok: true; annonce: AnnonceEntity } | { ok: false; status: number; error: string } {
  const state = getPlatformState();
  const annonce = state.annonces.find(
    (a) => a.id === input.annonceId && a.parishId === input.parishId
  );
  if (!annonce) {
    return { ok: false, status: 404, error: 'Annonce introuvable.' };
  }

  annonce.statut = 'PUBLISHED';
  annonce.approvedBy = input.actorUserId;
  savePlatformState(state);

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'ANNOUNCEMENT_APPROVED',
    targetType: 'ANNONCE',
    targetId: annonce.id,
    summary: `Approbation et publication de l’annonce « ${annonce.titre} ».`,
  });

  return { ok: true, annonce };
}
