import crypto from 'crypto';
import type { AnnonceEntity } from '../platform/platform.types.js';
import { recordAuditLog } from '../audit/audit.service.js';
import {
  deleteAnnonceRepo,
  findAnnonceByIdRepo,
  listAnnoncesByParishRepo,
  saveAnnonceRepo,
} from '../../repositories/massesAnnouncements.repository.js';
import { getPlatformSettings } from '../../repositories/system.repository.js';
import { findUserById } from '../../repositories/users.repository.js';

export const ANNONCE_TYPE_LABELS: Record<AnnonceEntity['type'], string> = {
  evenement: 'Événement',
  Deces: 'Décès',
  Communique: 'Communiqué',
  Solennite: 'Solennité',
};

const VALID_ANNONCE_TYPES: AnnonceEntity['type'][] = [
  'evenement',
  'Deces',
  'Communique',
  'Solennite',
];

export function normalizeAnnonceType(raw: string): AnnonceEntity['type'] {
  const trimmed = String(raw || '').trim();
  const found = VALID_ANNONCE_TYPES.find((t) => t.toLowerCase() === trimmed.toLowerCase());
  return found ?? 'Communique';
}

export async function listAnnouncementsForParish(parishId: string): Promise<AnnonceEntity[]> {
  return listAnnoncesByParishRepo(parishId);
}

export async function getAnnouncementDetailsForParish(parishId: string, annonceId: string) {
  const annonce = await findAnnonceByIdRepo(annonceId);
  if (!annonce || annonce.parishId !== parishId) return null;

  const [creator, approver] = await Promise.all([
    findUserById(annonce.createdBy),
    annonce.approvedBy ? findUserById(annonce.approvedBy) : Promise.resolve(null),
  ]);

  return {
    annonce,
    typeLabel: ANNONCE_TYPE_LABELS[annonce.type] || annonce.type,
    createdByName: creator ? creator.displayName : 'Secrétariat paroissial',
    approvedByName: approver ? approver.displayName : null,
  };
}

export async function createAnnouncementForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  type: AnnonceEntity['type'];
  titre: string;
  dateAnnonce: string;
  contenu: string;
  imageUrl?: string;
  annonceId?: string;
  canApproveDirectly: boolean;
}): Promise<{ ok: true; annonce: AnnonceEntity } | { ok: false; status: number; error: string }> {
  const titre = String(input.titre || '').trim().slice(0, 200);
  const contenu = String(input.contenu || '').trim().slice(0, 2000);
  const dateAnnonce = String(input.dateAnnonce || '').trim().slice(0, 40);

  if (!titre || !contenu || !dateAnnonce) {
    return { ok: false, status: 400, error: 'Titre, date et contenu de l’annonce requis.' };
  }

  const now = new Date().toISOString();
  const settings = await getPlatformSettings();
  const needsApproval = settings.requireCureAnnouncementApproval && !input.canApproveDirectly;

  const annonce: AnnonceEntity = {
    id: input.annonceId || `ann-${crypto.randomUUID().slice(0, 10)}`,
    parishId: input.parishId,
    type: normalizeAnnonceType(input.type),
    titre,
    dateAnnonce,
    contenu,
    imageUrl: input.imageUrl,
    statut: needsApproval ? 'PENDING_APPROVAL' : 'PUBLISHED',
    createdBy: input.actorUserId,
    approvedBy: needsApproval ? null : input.actorUserId,
    createdAt: now,
    updatedAt: now,
  };

  await saveAnnonceRepo(annonce);

  await recordAuditLog({
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

export async function updateAnnouncementForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  annonceId: string;
  type: string;
  titre: string;
  dateAnnonce: string;
  contenu: string;
  statut?: AnnonceEntity['statut'];
  canApproveDirectly: boolean;
}): Promise<{ ok: true; annonce: AnnonceEntity } | { ok: false; status: number; error: string }> {
  const titre = String(input.titre || '').trim().slice(0, 200);
  const contenu = String(input.contenu || '').trim().slice(0, 2000);
  const dateAnnonce = String(input.dateAnnonce || '').trim().slice(0, 40);

  if (!titre || !contenu || !dateAnnonce) {
    return { ok: false, status: 400, error: 'Titre, date et contenu de l’annonce requis.' };
  }

  const [annonce, settings] = await Promise.all([
    findAnnonceByIdRepo(input.annonceId),
    getPlatformSettings(),
  ]);
  if (!annonce || annonce.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Annonce introuvable.' };
  }

  annonce.type = normalizeAnnonceType(input.type);
  annonce.titre = titre;
  annonce.dateAnnonce = dateAnnonce;
  annonce.contenu = contenu;

  if (input.statut && ['PUBLISHED', 'PENDING_APPROVAL', 'ARCHIVED'].includes(input.statut)) {
    if (
      input.statut === 'PUBLISHED' &&
      settings.requireCureAnnouncementApproval &&
      !input.canApproveDirectly
    ) {
      annonce.statut = 'PENDING_APPROVAL';
      annonce.approvedBy = null;
    } else {
      annonce.statut = input.statut;
      if (input.statut === 'PUBLISHED') {
        annonce.approvedBy = input.actorUserId;
      }
    }
  }

  annonce.updatedAt = new Date().toISOString();
  await saveAnnonceRepo(annonce);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'ANNOUNCEMENT_UPDATED',
    targetType: 'ANNONCE',
    targetId: annonce.id,
    summary: `Modification de l’annonce « ${annonce.titre} ».`,
  });

  return { ok: true, annonce };
}

export async function approveAnnouncementForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  annonceId: string;
}): Promise<{ ok: true; annonce: AnnonceEntity } | { ok: false; status: number; error: string }> {
  const annonce = await findAnnonceByIdRepo(input.annonceId);
  if (!annonce || annonce.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Annonce introuvable.' };
  }

  annonce.statut = 'PUBLISHED';
  annonce.approvedBy = input.actorUserId;
  annonce.updatedAt = new Date().toISOString();
  await saveAnnonceRepo(annonce);

  await recordAuditLog({
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

export async function archiveAnnouncementForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  annonceId: string;
}): Promise<{ ok: true; annonce: AnnonceEntity } | { ok: false; status: number; error: string }> {
  const annonce = await findAnnonceByIdRepo(input.annonceId);
  if (!annonce || annonce.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Annonce introuvable.' };
  }

  annonce.statut = 'ARCHIVED';
  annonce.updatedAt = new Date().toISOString();
  await saveAnnonceRepo(annonce);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'ANNOUNCEMENT_ARCHIVED',
    targetType: 'ANNONCE',
    targetId: annonce.id,
    summary: `Archivage de l’annonce « ${annonce.titre} ».`,
  });

  return { ok: true, annonce };
}

export async function deleteAnnouncementForParish(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  annonceId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const annonce = await findAnnonceByIdRepo(input.annonceId);
  if (!annonce || annonce.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Annonce introuvable.' };
  }

  await deleteAnnonceRepo(annonce.id);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'ANNOUNCEMENT_DELETED',
    targetType: 'ANNONCE',
    targetId: annonce.id,
    summary: `Suppression de l’annonce « ${annonce.titre} ».`,
  });

  return { ok: true };
}
