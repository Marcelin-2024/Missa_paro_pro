import crypto from 'crypto';
import { findDioceseById, findParishById } from '../ecclesiastical/ecclesiastical.repository.js';
import type { ParishEntity, ParishStatus } from '../platform/platform.types.js';
import { recordAuditLog } from '../audit/audit.service.js';
import {
  findParishByIdOrDirectoryRepo,
  findParishByIdRepo,
  listActiveParishesRepo,
  listAllParishesRepo,
  saveParishRepo,
} from '../../repositories/parishes.repository.js';

export async function listAllParishes(): Promise<ParishEntity[]> {
  return listAllParishesRepo();
}

export async function listActiveParishes(): Promise<ParishEntity[]> {
  return listActiveParishesRepo();
}

export async function getParishById(parishId: string): Promise<ParishEntity | undefined> {
  const found = await findParishByIdRepo(parishId);
  return found ?? undefined;
}

export async function ensureDirectoryParishTenant(
  directoryParishId: string
): Promise<ParishEntity | null> {
  const existing = await findParishByIdOrDirectoryRepo(directoryParishId);
  if (existing) return existing;

  const match = findParishById(directoryParishId);
  if (!match) return null;

  const now = new Date().toISOString();
  const created: ParishEntity = {
    id: `parish_${match.parish.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    directoryParishId: match.parish.id,
    provinceId: match.province.id,
    provinceName: match.province.name,
    dioceseId: match.diocese.id,
    dioceseName: match.diocese.name,
    name: match.parish.name,
    location: match.parish.location,
    status: 'PENDING_ACTIVATION',
    phone: '',
    email: '',
    address: match.parish.location,
    massScheduleSummary: 'Horaires non encore configurés par la paroisse.',
    chapelsEnabled: false,
    chapels: [],
    createdAt: now,
    updatedAt: now,
  };

  await saveParishRepo(created);
  return created;
}

export async function provisionOrActivateParish(input: {
  actorUserId: string;
  actorEmail: string;
  provinceId: string;
  dioceseId: string;
  directoryParishId?: string;
  customParishName?: string;
  location?: string;
  phone?: string;
  email?: string;
  address?: string;
  massScheduleSummary?: string;
  status?: ParishStatus;
}): Promise<{ ok: true; parish: ParishEntity } | { ok: false; status: number; error: string }> {
  const dioMatch = findDioceseById(input.dioceseId);
  if (!dioMatch || dioMatch.province.id !== input.provinceId) {
    return { ok: false, status: 400, error: 'Province ou diocèse invalide.' };
  }

  const now = new Date().toISOString();

  if (input.directoryParishId) {
    const dirMatch = findParishById(input.directoryParishId);
    if (!dirMatch || dirMatch.diocese.id !== dioMatch.diocese.id) {
      return {
        ok: false,
        status: 400,
        error: 'La paroisse sélectionnée ne correspond pas au diocèse.',
      };
    }
    const existing = await ensureDirectoryParishTenant(dirMatch.parish.id);
    if (existing) {
      existing.status = input.status ?? 'ACTIVE';
      if (typeof input.phone === 'string' && input.phone.trim()) {
        existing.phone = input.phone.trim().slice(0, 40);
      }
      if (typeof input.email === 'string' && input.email.trim()) {
        existing.email = input.email.trim().slice(0, 120);
      }
      if (typeof input.address === 'string' && input.address.trim()) {
        existing.address = input.address.trim().slice(0, 200);
      }
      if (typeof input.massScheduleSummary === 'string' && input.massScheduleSummary.trim()) {
        existing.massScheduleSummary = input.massScheduleSummary.trim().slice(0, 300);
      }
      existing.updatedAt = now;
      await saveParishRepo(existing);
      await recordAuditLog({
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        scope: 'GLOBAL',
        parishId: existing.id,
        action: 'PARISH_ACTIVATED',
        targetType: 'PARISH',
        targetId: existing.id,
        summary: `Espace paroissial ${existing.name} configuré (${existing.status}).`,
      });
      return { ok: true, parish: existing };
    }
  }

  const cleanName = String(input.customParishName || '').trim().slice(0, 120);
  if (cleanName.length < 2) {
    return { ok: false, status: 400, error: 'Nom de paroisse requis.' };
  }

  const created: ParishEntity = {
    id: `parish_${crypto.randomUUID().slice(0, 10)}`,
    directoryParishId: null,
    provinceId: dioMatch.province.id,
    provinceName: dioMatch.province.name,
    dioceseId: dioMatch.diocese.id,
    dioceseName: dioMatch.diocese.name,
    name: cleanName,
    location: String(input.location || dioMatch.diocese.name).trim().slice(0, 120),
    status: input.status ?? 'ACTIVE',
    phone: String(input.phone || '').trim().slice(0, 40),
    email: String(input.email || '').trim().slice(0, 120),
    address: String(input.address || '').trim().slice(0, 200),
    massScheduleSummary:
      String(input.massScheduleSummary || '').trim().slice(0, 300) || 'Horaires à configurer',
    chapelsEnabled: false,
    chapels: [],
    createdAt: now,
    updatedAt: now,
  };

  await saveParishRepo(created);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'GLOBAL',
    parishId: created.id,
    action: 'PARISH_CREATED',
    targetType: 'PARISH',
    targetId: created.id,
    summary: `Création de l’espace paroissial ${created.name}.`,
  });

  return { ok: true, parish: created };
}

export async function updateParishBySuperAdmin(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  name?: string;
  location?: string;
  phone?: string;
  email?: string;
  address?: string;
  massScheduleSummary?: string;
  chapelsEnabled?: boolean;
  chapels?: string[];
  status?: ParishStatus;
}): Promise<{ ok: true; parish: ParishEntity } | { ok: false; status: number; error: string }> {
  const parish = await findParishByIdRepo(input.parishId);
  if (!parish) {
    return { ok: false, status: 404, error: 'Paroisse introuvable.' };
  }

  if (typeof input.name === 'string') {
    const cleanName = input.name.trim().slice(0, 160);
    if (cleanName.length < 2) {
      return {
        ok: false,
        status: 400,
        error: 'Le nom de la paroisse est obligatoire (min. 2 caractères).',
      };
    }
    parish.name = cleanName;
  }
  if (typeof input.location === 'string') {
    parish.location = input.location.trim().slice(0, 120) || parish.dioceseName;
  }
  if (typeof input.phone === 'string') {
    parish.phone = input.phone.trim().slice(0, 40);
  }
  if (typeof input.email === 'string') {
    parish.email = input.email.trim().slice(0, 120);
  }
  if (typeof input.address === 'string') {
    parish.address = input.address.trim().slice(0, 200);
  }
  if (typeof input.massScheduleSummary === 'string') {
    parish.massScheduleSummary = input.massScheduleSummary.trim().slice(0, 300);
  }
  if (typeof input.chapelsEnabled === 'boolean') {
    parish.chapelsEnabled = input.chapelsEnabled;
    if (!input.chapelsEnabled) {
      parish.chapels = [];
    }
  }
  if (Array.isArray(input.chapels) && parish.chapelsEnabled) {
    parish.chapels = input.chapels
      .map((c) => c.trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 15);
  }
  if (input.status) {
    const valid: ParishStatus[] = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE'];
    if (!valid.includes(input.status)) {
      return { ok: false, status: 400, error: 'Statut paroissial invalide.' };
    }
    parish.status = input.status;
  }

  parish.updatedAt = new Date().toISOString();
  await saveParishRepo(parish);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'GLOBAL',
    parishId: parish.id,
    action: 'PARISH_UPDATED',
    targetType: 'PARISH',
    targetId: parish.id,
    summary: `Mise à jour de la fiche paroissiale ${parish.name}.`,
  });

  return { ok: true, parish };
}

export async function updateParishStatus(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  status: ParishStatus;
}): Promise<{ ok: true; parish: ParishEntity } | { ok: false; status: number; error: string }> {
  const valid: ParishStatus[] = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE'];
  if (!valid.includes(input.status)) {
    return { ok: false, status: 400, error: 'Statut paroissial invalide.' };
  }

  const parish = await findParishByIdRepo(input.parishId);
  if (!parish) {
    return { ok: false, status: 404, error: 'Paroisse introuvable.' };
  }

  const previousStatus = parish.status;
  parish.status = input.status;
  parish.updatedAt = new Date().toISOString();
  await saveParishRepo(parish);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'GLOBAL',
    parishId: parish.id,
    action: 'PARISH_STATUS_CHANGED',
    targetType: 'PARISH',
    targetId: parish.id,
    summary: `Statut de ${parish.name} : ${previousStatus} → ${input.status}.`,
  });

  return { ok: true, parish };
}

export async function updateParishPracticalInfo(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  location?: string;
  phone: string;
  email: string;
  address: string;
  massScheduleSummary: string;
  chapelsEnabled: boolean;
  chapels: string[];
}): Promise<{ ok: true; parish: ParishEntity } | { ok: false; status: number; error: string }> {
  const parish = await findParishByIdRepo(input.parishId);
  if (!parish) {
    return { ok: false, status: 404, error: 'Paroisse introuvable.' };
  }

  if (typeof input.location === 'string' && input.location.trim()) {
    parish.location = input.location.trim().slice(0, 120);
  }
  parish.phone = input.phone.trim().slice(0, 40);
  parish.email = input.email.trim().slice(0, 120);
  parish.address = input.address.trim().slice(0, 200);
  parish.massScheduleSummary = input.massScheduleSummary.trim().slice(0, 300);
  parish.chapelsEnabled = input.chapelsEnabled;
  parish.chapels = input.chapelsEnabled
    ? input.chapels.map((c) => c.trim().slice(0, 100)).filter(Boolean).slice(0, 15)
    : [];
  parish.updatedAt = new Date().toISOString();
  await saveParishRepo(parish);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: parish.id,
    action: 'PARISH_INFO_UPDATED',
    targetType: 'PARISH',
    targetId: parish.id,
    summary: `Mise à jour des informations pratiques de ${parish.name}.`,
  });

  return { ok: true, parish };
}
