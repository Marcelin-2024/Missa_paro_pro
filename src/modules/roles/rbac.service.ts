import crypto from 'crypto';
import { getPlatformState, savePlatformState } from '../platform/platform.repository.js';
import type {
  MembershipRoleEntity,
  ParishMembershipEntity,
  PermissionCode,
  RoleCode,
} from '../platform/platform.types.js';
import { ALL_ROLE_CODES, ROLE_CATALOG } from './rbac.catalog.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';

export interface EffectiveAccessContext {
  membership: ParishMembershipEntity;
  activeRoles: RoleCode[];
  permissions: PermissionCode[];
}

export function expireOutdatedRoles(): boolean {
  const state = getPlatformState();
  const nowMs = Date.now();
  let changed = false;

  for (const assignment of state.membershipRoles) {
    if (
      assignment.status === 'ACTIVE' &&
      assignment.expiresAt &&
      new Date(assignment.expiresAt).getTime() <= nowMs
    ) {
      assignment.status = 'EXPIRED';
      changed = true;
    }
  }

  if (changed) {
    savePlatformState(state);
  }
  return changed;
}

export function computeEffectiveAccess(
  userId: string,
  parishId: string
): EffectiveAccessContext | null {
  expireOutdatedRoles();
  const state = getPlatformState();

  const user = state.users.find((u) => u.id === userId);
  if (!user || user.status !== 'ACTIVE') return null;

  const parish = state.parishes.find((p) => p.id === parishId);
  if (!parish || parish.status !== 'ACTIVE') return null;

  const membership = state.memberships.find(
    (m) => m.userId === userId && m.parishId === parishId && m.status === 'ACTIVE'
  );
  if (!membership) return null;

  const activeAssignments = state.membershipRoles.filter(
    (mr) =>
      mr.membershipId === membership.id &&
      mr.parishId === parishId &&
      mr.status === 'ACTIVE'
  );

  const roleSet = new Set<RoleCode>();
  const permSet = new Set<PermissionCode>();

  for (const assignment of activeAssignments) {
    const def = ROLE_CATALOG[assignment.roleCode];
    if (!def) continue;
    roleSet.add(assignment.roleCode);
    for (const perm of def.permissions) {
      permSet.add(perm);
    }
  }

  return {
    membership,
    activeRoles: Array.from(roleSet),
    permissions: Array.from(permSet),
  };
}

export function getUserActiveMemberships(userId: string) {
  expireOutdatedRoles();
  const state = getPlatformState();
  const user = state.users.find((u) => u.id === userId);
  if (!user || user.status !== 'ACTIVE') return [];

  return state.memberships
    .filter((m) => m.userId === userId && m.status === 'ACTIVE')
    .map((m) => {
      const parish = state.parishes.find((p) => p.id === m.parishId);
      const access = computeEffectiveAccess(userId, m.parishId);
      return {
        membership: m,
        parish,
        roles: access?.activeRoles ?? [],
        permissions: access?.permissions ?? [],
      };
    })
    .filter((entry) => entry.parish && entry.parish.status === 'ACTIVE');
}

export function assignRoleToMembership(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  membershipId: string;
  roleCode: string;
  expiresAt?: string | null;
}): { ok: true; assignment: MembershipRoleEntity } | { ok: false; status: number; error: string } {
  const roleCode = input.roleCode as RoleCode;
  if (!ALL_ROLE_CODES.includes(roleCode)) {
    return { ok: false, status: 400, error: 'Rôle paroissial invalide.' };
  }

  const state = getPlatformState();
  const membership = state.memberships.find(
    (m) => m.id === input.membershipId && m.parishId === input.parishId && m.status !== 'REMOVED'
  );
  if (!membership) {
    return { ok: false, status: 404, error: 'Appartenance paroissiale introuvable.' };
  }

  const now = new Date().toISOString();
  const existing = state.membershipRoles.find(
    (mr) =>
      mr.membershipId === membership.id &&
      mr.roleCode === roleCode &&
      mr.status === 'ACTIVE'
  );

  if (existing) {
    existing.expiresAt = input.expiresAt || null;
    savePlatformState(state);
    return { ok: true, assignment: existing };
  }

  const assignment: MembershipRoleEntity = {
    id: `mrole-${crypto.randomUUID().slice(0, 12)}`,
    membershipId: membership.id,
    parishId: membership.parishId,
    userId: membership.userId,
    roleCode,
    status: 'ACTIVE',
    assignedBy: input.actorUserId,
    assignedAt: now,
    expiresAt: input.expiresAt || null,
    revokedAt: null,
    revokedBy: null,
  };

  state.membershipRoles.push(assignment);
  savePlatformState(state);

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: membership.parishId,
    action: 'ROLE_ASSIGNED',
    targetType: 'MEMBERSHIP_ROLE',
    targetId: assignment.id,
    summary: `Attribution du rôle ${ROLE_CATALOG[roleCode].label} sur la paroisse ${membership.parishId}.`,
  });

  createNotification({
    userId: membership.userId,
    parishId: membership.parishId,
    audience: 'PARISH_ADMIN',
    type: 'ROLE_ASSIGNED',
    title: 'Rôle attribué',
    message: `Le rôle ${ROLE_CATALOG[roleCode].label} vous a été attribué.`,
  });

  return { ok: true, assignment };
}

export function revokeRoleFromMembership(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  membershipId: string;
  roleCode: string;
}): { ok: true } | { ok: false; status: number; error: string } {
  expireOutdatedRoles();
  const state = getPlatformState();
  const roleCode = input.roleCode as RoleCode;

  const membership = state.memberships.find(
    (m) => m.id === input.membershipId && m.parishId === input.parishId
  );
  if (!membership) {
    return { ok: false, status: 404, error: 'Appartenance paroissiale introuvable.' };
  }

  const target = state.membershipRoles.find(
    (mr) =>
      mr.membershipId === membership.id &&
      mr.roleCode === roleCode &&
      mr.status === 'ACTIVE'
  );
  if (!target) {
    return { ok: false, status: 404, error: 'Ce rôle actif n’est pas attribué à ce membre.' };
  }

  // Prevent removing the last active PARISH_ADMIN in a parish
  if (roleCode === 'PARISH_ADMIN') {
    const remainingActiveAdminsInParish = state.membershipRoles.filter((mr) => {
      if (
        mr.id === target.id ||
        mr.parishId !== input.parishId ||
        mr.roleCode !== 'PARISH_ADMIN' ||
        mr.status !== 'ACTIVE'
      ) {
        return false;
      }
      const m = state.memberships.find((mem) => mem.id === mr.membershipId && mem.status === 'ACTIVE');
      const u = state.users.find((usr) => usr.id === mr.userId && usr.status === 'ACTIVE');
      return Boolean(m && u);
    });

    if (remainingActiveAdminsInParish.length === 0) {
      return {
        ok: false,
        status: 409,
        error:
          'Impossible de retirer le dernier administrateur paroissial sans désigner d’abord un remplaçant.',
      };
    }
  }

  target.status = 'REVOKED';
  target.revokedAt = new Date().toISOString();
  target.revokedBy = input.actorUserId;
  savePlatformState(state);

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: membership.parishId,
    action: 'ROLE_REVOKED',
    targetType: 'MEMBERSHIP_ROLE',
    targetId: target.id,
    summary: `Retrait du rôle ${ROLE_CATALOG[roleCode].label} pour l’appartenance ${membership.id}.`,
  });

  createNotification({
    userId: membership.userId,
    parishId: membership.parishId,
    audience: 'PARISH_ADMIN',
    type: 'ROLE_REVOKED',
    title: 'Rôle retiré',
    message: `Le rôle ${ROLE_CATALOG[roleCode].label} vous a été retiré.`,
  });

  return { ok: true };
}
