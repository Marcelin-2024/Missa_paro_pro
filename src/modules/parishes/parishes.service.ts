import crypto from 'crypto';
import { findDioceseById, findParishById } from '../ecclesiastical/ecclesiastical.repository.js';
import { getPlatformState, savePlatformState } from '../platform/platform.repository.js';
import type { ParishEntity, ParishStatus } from '../platform/platform.types.js';
import { recordAuditLog } from '../audit/audit.service.js';

export function listAllParishes(): ParishEntity[] {
  return getPlatformState().parishes;
}

export function getParishById(parishId: string): ParishEntity | undefined {
  return getPlatformState().parishes.find((p) => p.id === parishId);
}

export function ensureDirectoryParishTenant(directoryParishId: string): ParishEntity | null {
  const state = getPlatformState();
  const existing = state.parishes.find(
    (p) => p.id === directoryParishId || p.directoryParishId === directoryParishId
  );
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

  state.parishes.push(created);
  savePlatformState(state);
  return created;
}

export function provisionOrActivateParish(input: {
  actorUserId: string;
  actorEmail: string;
  provinceId: string;
  dioceseId: string;
  directoryParishId?: string;
  customParishName?: string;
  location?: string;
  status?: ParishStatus;
}): { ok: true; parish: ParishEntity } | { ok: false; status: number; error: string } {
  const dioMatch = findDioceseById(input.dioceseId);
  if (!dioMatch || dioMatch.province.id !== input.provinceId) {
    return { ok: false, status: 400, error: 'Province ou diocèse invalide.' };
  }

  const state = getPlatformState();
  const now = new Date().toISOString();

  if (input.directoryParishId) {
    const dirMatch = findParishById(input.directoryParishId);
    if (!dirMatch || dirMatch.diocese.id !== dioMatch.diocese.id) {
      return { ok: false, status: 400, error: 'La paroisse sélectionnée ne correspond pas au diocèse.' };
    }
    const existing = ensureDirectoryParishTenant(dirMatch.parish.id);
    if (existing) {
      existing.status = input.status ?? 'ACTIVE';
      existing.updatedAt = now;
      savePlatformState(state);
      recordAuditLog({
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
    phone: '',
    email: '',
    address: '',
    massScheduleSummary: 'Horaires à configurer',
    chapelsEnabled: false,
    chapels: [],
    createdAt: now,
    updatedAt: now,
  };

  state.parishes.push(created);
  savePlatformState(state);

  recordAuditLog({
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

export function updateParishStatus(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  status: ParishStatus;
}): { ok: true; parish: ParishEntity } | { ok: false; status: number; error: string } {
  const valid: ParishStatus[] = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE'];
  if (!valid.includes(input.status)) {
    return { ok: false, status: 400, error: 'Statut paroissial invalide.' };
  }

  const state = getPlatformState();
  const parish = state.parishes.find((p) => p.id === input.parishId);
  if (!parish) {
    return { ok: false, status: 404, error: 'Paroisse introuvable.' };
  }

  const previousStatus = parish.status;
  parish.status = input.status;
  parish.updatedAt = new Date().toISOString();
  savePlatformState(state);

  recordAuditLog({
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

export function updateParishPracticalInfo(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  phone: string;
  email: string;
  address: string;
  massScheduleSummary: string;
  chapelsEnabled: boolean;
  chapels: string[];
}): { ok: true; parish: ParishEntity } | { ok: false; status: number; error: string } {
  const state = getPlatformState();
  const parish = state.parishes.find((p) => p.id === input.parishId);
  if (!parish) {
    return { ok: false, status: 404, error: 'Paroisse introuvable.' };
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
  savePlatformState(state);

  recordAuditLog({
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
