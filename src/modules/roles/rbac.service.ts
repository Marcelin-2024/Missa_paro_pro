import crypto from 'crypto';
import type {
  MembershipRoleEntity,
  ParishEntity,
  ParishMembershipEntity,
  PermissionCode,
  RoleCode,
} from '../platform/platform.types.js';
import { ALL_ROLE_CODES, ROLE_CATALOG } from './rbac.catalog.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import { findUserById } from '../../repositories/users.repository.js';
import {
  expireOutdatedRolesRepo,
  findActiveMembershipRepo,
  findMembershipByIdRepo,
  findParishByIdRepo,
  listAllParishesRepo,
  listMembershipRolesByMembershipRepo,
  listMembershipRolesByParishRepo,
  listMembershipsByParishRepo,
  listMembershipsByUserRepo,
  saveMembershipRoleRepo,
} from '../../repositories/parishes.repository.js';

export interface EffectiveAccessContext {
  membership: ParishMembershipEntity;
  activeRoles: RoleCode[];
  permissions: PermissionCode[];
}

export interface ActiveMembershipEntry {
  membership: ParishMembershipEntity;
  parish: ParishEntity;
  roles: RoleCode[];
  permissions: PermissionCode[];
}

export async function expireOutdatedRoles(scope?: {
  parishId?: string;
  userId?: string;
}): Promise<boolean> {
  return expireOutdatedRolesRepo(scope);
}

export async function computeEffectiveAccess(
  userId: string,
  parishId: string
): Promise<EffectiveAccessContext | null> {
  await expireOutdatedRoles({ parishId });

  const [user, parish, membership] = await Promise.all([
    findUserById(userId),
    findParishByIdRepo(parishId),
    findActiveMembershipRepo(userId, parishId),
  ]);

  if (!user || user.status !== 'ACTIVE') return null;
  if (!parish || parish.status !== 'ACTIVE') return null;
  if (!membership || membership.status !== 'ACTIVE') return null;

  const assignments = await listMembershipRolesByMembershipRepo(membership.id);
  const activeAssignments = assignments.filter(
    (mr) => mr.parishId === parishId && mr.status === 'ACTIVE'
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

export async function getUserActiveMemberships(userId: string): Promise<ActiveMembershipEntry[]> {
  await expireOutdatedRoles({ userId });
  const user = await findUserById(userId);
  if (!user || user.status !== 'ACTIVE') return [];

  const [memberships, allParishes] = await Promise.all([
    listMembershipsByUserRepo(userId),
    listAllParishesRepo(),
  ]);
  const parishMap = new Map(allParishes.map((p) => [p.id, p]));

  const entries: ActiveMembershipEntry[] = [];
  for (const membership of memberships) {
    if (membership.status !== 'ACTIVE') continue;
    const parish = parishMap.get(membership.parishId);
    if (!parish || parish.status !== 'ACTIVE') continue;
    const access = await computeEffectiveAccess(userId, membership.parishId);
    entries.push({
      membership,
      parish,
      roles: access?.activeRoles ?? [],
      permissions: access?.permissions ?? [],
    });
  }

  return entries;
}

export async function assignRoleToMembership(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  membershipId: string;
  roleCode: string;
  expiresAt?: string | null;
}): Promise<
  { ok: true; assignment: MembershipRoleEntity } | { ok: false; status: number; error: string }
> {
  const roleCode = input.roleCode as RoleCode;
  if (!ALL_ROLE_CODES.includes(roleCode)) {
    return { ok: false, status: 400, error: 'Rôle paroissial invalide.' };
  }

  const membership = await findMembershipByIdRepo(input.membershipId);
  if (!membership || membership.parishId !== input.parishId || membership.status === 'REMOVED') {
    return { ok: false, status: 404, error: 'Appartenance paroissiale introuvable.' };
  }

  const now = new Date().toISOString();
  const assignments = await listMembershipRolesByMembershipRepo(membership.id);
  const existing = assignments.find(
    (mr) => mr.roleCode === roleCode && mr.status === 'ACTIVE'
  );

  if (existing) {
    existing.expiresAt = input.expiresAt || null;
    await saveMembershipRoleRepo(existing);
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

  await saveMembershipRoleRepo(assignment);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: membership.parishId,
    action: 'ROLE_ASSIGNED',
    targetType: 'MEMBERSHIP_ROLE',
    targetId: assignment.id,
    summary: `Attribution du rôle ${ROLE_CATALOG[roleCode].label} sur la paroisse ${membership.parishId}.`,
  });

  await createNotification({
    userId: membership.userId,
    parishId: membership.parishId,
    audience: 'PARISH_ADMIN',
    type: 'ROLE_ASSIGNED',
    title: 'Rôle attribué',
    message: `Le rôle ${ROLE_CATALOG[roleCode].label} vous a été attribué.`,
  });

  return { ok: true, assignment };
}

export async function revokeRoleFromMembership(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  membershipId: string;
  roleCode: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  await expireOutdatedRoles({ parishId: input.parishId });
  const roleCode = input.roleCode as RoleCode;

  const membership = await findMembershipByIdRepo(input.membershipId);
  if (!membership || membership.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Appartenance paroissiale introuvable.' };
  }

  const [membershipRoles, parishRoles, parishMemberships] = await Promise.all([
    listMembershipRolesByMembershipRepo(membership.id),
    listMembershipRolesByParishRepo(input.parishId),
    listMembershipsByParishRepo(input.parishId),
  ]);

  const target = membershipRoles.find(
    (mr) => mr.roleCode === roleCode && mr.status === 'ACTIVE'
  );
  if (!target) {
    return { ok: false, status: 404, error: 'Ce rôle actif n’est pas attribué à ce membre.' };
  }

  if (roleCode === 'PARISH_ADMIN') {
    const activeMembershipIds = new Set(
      parishMemberships.filter((m) => m.status === 'ACTIVE').map((m) => m.id)
    );
    const otherAdminRoles = parishRoles.filter(
      (mr) =>
        mr.id !== target.id &&
        mr.roleCode === 'PARISH_ADMIN' &&
        mr.status === 'ACTIVE' &&
        activeMembershipIds.has(mr.membershipId)
    );

    let activeAdminsRemaining = 0;
    for (const mr of otherAdminRoles) {
      const user = await findUserById(mr.userId);
      if (user && user.status === 'ACTIVE') {
        activeAdminsRemaining += 1;
      }
    }

    if (activeAdminsRemaining === 0) {
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
  await saveMembershipRoleRepo(target);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: membership.parishId,
    action: 'ROLE_REVOKED',
    targetType: 'MEMBERSHIP_ROLE',
    targetId: target.id,
    summary: `Retrait du rôle ${ROLE_CATALOG[roleCode].label} pour l’appartenance ${membership.id}.`,
  });

  await createNotification({
    userId: membership.userId,
    parishId: membership.parishId,
    audience: 'PARISH_ADMIN',
    type: 'ROLE_REVOKED',
    title: 'Rôle retiré',
    message: `Le rôle ${ROLE_CATALOG[roleCode].label} vous a été retiré.`,
  });

  return { ok: true };
}
