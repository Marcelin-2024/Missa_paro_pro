import crypto from 'crypto';
import { getPlatformState, savePlatformState } from '../platform/platform.repository.js';
import type {
  ParishMembershipEntity,
  RoleCode,
  UserAccountStatus,
  UserEntity,
} from '../platform/platform.types.js';
import {
  generateActivationToken,
  generateTempPassword,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../auth/password.utils.js';
import { ALL_ROLE_CODES, ROLE_CATALOG } from '../roles/rbac.catalog.js';
import { assignRoleToMembership, computeEffectiveAccess } from '../roles/rbac.service.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import { provisionOrActivateParish } from '../parishes/parishes.service.js';

export interface SafeUserSummary {
  id: string;
  email: string;
  displayName: string;
  phone: string;
  accountType: UserEntity['accountType'];
  isSuperAdmin: boolean;
  status: UserAccountStatus;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export function sanitizeUser(user: UserEntity): SafeUserSummary {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    phone: user.phone,
    accountType: user.accountType,
    isSuperAdmin: user.isSuperAdmin,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function authenticateWithCredentials(
  email: string,
  password: string
):
  | { ok: true; user: UserEntity }
  | { ok: false; code: string; message: string } {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const state = getPlatformState();
  const user = state.users.find((u) => u.email.toLowerCase() === cleanEmail);

  if (!user || !user.passwordHash) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' };
  }

  if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
    return {
      ok: false,
      code: 'ACCOUNT_SUSPENDED',
      message: 'Ce compte est suspendu ou désactivé. Contactez votre administrateur.',
    };
  }

  if (
    user.mustChangePassword &&
    user.tempPasswordExpiresAt &&
    new Date(user.tempPasswordExpiresAt).getTime() <= Date.now()
  ) {
    return {
      ok: false,
      code: 'TEMP_PASSWORD_EXPIRED',
      message: 'Votre mot de passe temporaire a expiré. Demandez une réinitialisation d’accès.',
    };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' };
  }

  if (user.accountType === 'PARISH_STAFF' && !user.isSuperAdmin) {
    const hasActiveMembership = state.memberships.some((m) => {
      if (m.userId !== user.id || m.status !== 'ACTIVE') return false;
      const parish = state.parishes.find((p) => p.id === m.parishId);
      return Boolean(parish && parish.status === 'ACTIVE');
    });
    if (!hasActiveMembership) {
      return {
        ok: false,
        code: 'MEMBERSHIP_SUSPENDED',
        message: 'Votre rattachement paroissial est suspendu ou votre paroisse est inactive.',
      };
    }
  }

  if (user.status === 'PENDING_ACTIVATION') {
    user.status = 'ACTIVE';
  }
  user.lastLoginAt = new Date().toISOString();
  user.updatedAt = user.lastLoginAt;
  savePlatformState(state);

  return { ok: true, user };
}

export function claimInitialSuperAdminPassword(
  email: string,
  newPassword: string
): { ok: true; user: UserEntity } | { ok: false; status: number; error: string } {
  const state = getPlatformState();
  if (state.superAdminClaimed) {
    return { ok: false, status: 403, error: 'Le compte Super Administrateur est déjà initialisé.' };
  }
  if ((process.env.SUPER_ADMIN_PASSWORD || '').trim()) {
    return {
      ok: false,
      status: 403,
      error: 'Le mot de passe Super Administrateur est géré par la configuration serveur.',
    };
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  const superAdmin = state.users.find((u) => u.isSuperAdmin && u.email.toLowerCase() === cleanEmail);
  if (!superAdmin) {
    return { ok: false, status: 404, error: 'Adresse Super Administrateur non reconnue.' };
  }
  if (newPassword.length < 8) {
    return { ok: false, status: 400, error: 'Le mot de passe doit contenir au moins 8 caractères.' };
  }

  const now = new Date().toISOString();
  superAdmin.passwordHash = hashPassword(newPassword);
  superAdmin.status = 'ACTIVE';
  superAdmin.mustChangePassword = false;
  superAdmin.updatedAt = now;
  state.superAdminClaimed = true;
  savePlatformState(state);

  recordAuditLog({
    actorUserId: superAdmin.id,
    actorEmail: superAdmin.email,
    scope: 'GLOBAL',
    parishId: null,
    action: 'SUPER_ADMIN_CLAIMED',
    targetType: 'USER',
    targetId: superAdmin.id,
    summary: 'Activation initiale sécurisée du compte Super Administrateur.',
  });

  return { ok: true, user: superAdmin };
}

export function createParishAdminBySuperAdmin(input: {
  actorUserId: string;
  actorEmail: string;
  provinceId: string;
  dioceseId: string;
  directoryParishId?: string;
  customParishName?: string;
  displayName: string;
  email: string;
  phone: string;
  tempPasswordTtlHours?: number;
  customTempPassword?: string;
}):
  | {
      ok: true;
      user: SafeUserSummary;
      parishId: string;
      parishName: string;
      temporaryPassword: string;
      activationToken: string;
      expiresAt: string;
    }
  | { ok: false; status: number; error: string } {
  const cleanEmail = String(input.email || '').trim().toLowerCase();
  const cleanName = String(input.displayName || '').trim().slice(0, 120);
  if (!cleanEmail || !cleanEmail.includes('@') || cleanName.length < 2) {
    return { ok: false, status: 400, error: 'Nom complet et adresse e-mail valides requis.' };
  }

  const parishResult = provisionOrActivateParish({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    provinceId: input.provinceId,
    dioceseId: input.dioceseId,
    directoryParishId: input.directoryParishId,
    customParishName: input.customParishName,
    status: 'ACTIVE',
  });
  if (!parishResult.ok) return parishResult;

  const state = getPlatformState();
  const now = new Date().toISOString();
  const ttlHours = input.tempPasswordTtlHours ?? state.settings.tempPasswordTtlHours ?? 48;
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  const temporaryPassword = input.customTempPassword?.trim() || generateTempPassword(14);
  const { rawToken, tokenHash } = generateActivationToken();

  let user = state.users.find((u) => u.email.toLowerCase() === cleanEmail);
  if (user && user.isSuperAdmin) {
    return {
      ok: false,
      status: 409,
      error: 'Un Super Administrateur ne peut pas être converti en administrateur paroissial.',
    };
  }

  if (!user) {
    user = {
      id: `user-${crypto.randomUUID().slice(0, 12)}`,
      email: cleanEmail,
      displayName: cleanName,
      phone: String(input.phone || '').trim().slice(0, 40),
      passwordHash: hashPassword(temporaryPassword),
      accountType: 'PARISH_STAFF',
      isSuperAdmin: false,
      status: 'PENDING_ACTIVATION',
      mustChangePassword: true,
      tempPasswordExpiresAt: expiresAt,
      activationTokenHash: tokenHash,
      activationExpiresAt: expiresAt,
      preferredProvinceId: parishResult.parish.provinceId,
      preferredDioceseId: parishResult.parish.dioceseId,
      preferredParishId: parishResult.parish.id,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    state.users.push(user);
  } else {
    user.accountType = 'PARISH_STAFF';
    user.passwordHash = hashPassword(temporaryPassword);
    user.mustChangePassword = true;
    user.tempPasswordExpiresAt = expiresAt;
    user.activationTokenHash = tokenHash;
    user.activationExpiresAt = expiresAt;
    user.updatedAt = now;
  }

  let membership = state.memberships.find(
    (m) => m.userId === user.id && m.parishId === parishResult.parish.id && m.status !== 'REMOVED'
  );
  if (!membership) {
    membership = {
      id: `mem-${crypto.randomUUID().slice(0, 12)}`,
      userId: user.id,
      parishId: parishResult.parish.id,
      status: 'ACTIVE',
      titleLabel: 'Administrateur paroissial',
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorUserId,
    };
    state.memberships.push(membership);
  }
  savePlatformState(state);

  assignRoleToMembership({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    parishId: parishResult.parish.id,
    membershipId: membership.id,
    roleCode: 'PARISH_ADMIN',
  });

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'GLOBAL',
    parishId: parishResult.parish.id,
    action: 'PARISH_ADMIN_CREATED',
    targetType: 'USER',
    targetId: user.id,
    summary: `Création de l’administrateur paroissial ${user.email} pour ${parishResult.parish.name}.`,
  });

  createNotification({
    userId: user.id,
    parishId: parishResult.parish.id,
    audience: 'PARISH_ADMIN',
    type: 'ADMIN_ACCOUNT_CREATED',
    title: 'Compte administrateur créé',
    message: `Votre espace pour ${parishResult.parish.name} a été créé. Modifiez votre mot de passe à la première connexion.`,
  });

  return {
    ok: true,
    user: sanitizeUser(user),
    parishId: parishResult.parish.id,
    parishName: parishResult.parish.name,
    temporaryPassword,
    activationToken: rawToken,
    expiresAt,
  };
}

export function resetAdminAccessBySuperAdmin(input: {
  actorUserId: string;
  actorEmail: string;
  userId: string;
  ttlHours?: number;
}):
  | { ok: true; temporaryPassword: string; activationToken: string; expiresAt: string }
  | { ok: false; status: number; error: string } {
  const state = getPlatformState();
  const user = state.users.find((u) => u.id === input.userId && !u.isSuperAdmin);
  if (!user) {
    return { ok: false, status: 404, error: 'Administrateur introuvable.' };
  }

  const ttlHours = input.ttlHours ?? state.settings.tempPasswordTtlHours ?? 48;
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  const temporaryPassword = generateTempPassword(14);
  const { rawToken, tokenHash } = generateActivationToken();

  user.passwordHash = hashPassword(temporaryPassword);
  user.mustChangePassword = true;
  user.tempPasswordExpiresAt = expiresAt;
  user.activationTokenHash = tokenHash;
  user.activationExpiresAt = expiresAt;
  user.updatedAt = new Date().toISOString();
  savePlatformState(state);

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'GLOBAL',
    parishId: user.preferredParishId ?? null,
    action: 'PARISH_ADMIN_ACCESS_RESET',
    targetType: 'USER',
    targetId: user.id,
    summary: `Réinitialisation d’accès pour ${user.email}.`,
  });

  createNotification({
    userId: user.id,
    parishId: user.preferredParishId ?? null,
    audience: 'PARISH_ADMIN',
    type: 'PASSWORD_RESET_REQUIRED',
    title: 'Renouvellement de mot de passe requis',
    message: 'Un nouvel accès temporaire a été généré par le Super Administrateur.',
  });

  return { ok: true, temporaryPassword, activationToken: rawToken, expiresAt };
}

export function updateUserStatus(input: {
  actorUserId: string;
  actorEmail: string;
  userId: string;
  status: UserAccountStatus;
  scope: 'GLOBAL' | 'PARISH';
  parishId?: string | null;
}): { ok: true; user: SafeUserSummary } | { ok: false; status: number; error: string } {
  const allowed: UserAccountStatus[] = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DISABLED'];
  if (!allowed.includes(input.status)) {
    return { ok: false, status: 400, error: 'Statut de compte invalide.' };
  }

  const state = getPlatformState();
  const user = state.users.find((u) => u.id === input.userId);
  if (!user) {
    return { ok: false, status: 404, error: 'Compte utilisateur introuvable.' };
  }
  if (user.isSuperAdmin && input.scope !== 'GLOBAL') {
    return { ok: false, status: 403, error: 'Action interdite sur un Super Administrateur.' };
  }
  if (user.id === input.actorUserId && input.status !== 'ACTIVE') {
    return { ok: false, status: 400, error: 'Vous ne pouvez pas suspendre votre propre compte.' };
  }

  const prev = user.status;
  user.status = input.status;
  user.updatedAt = new Date().toISOString();
  savePlatformState(state);

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: input.scope,
    parishId: input.parishId ?? null,
    action: 'USER_STATUS_CHANGED',
    targetType: 'USER',
    targetId: user.id,
    summary: `Statut du compte ${user.email} : ${prev} → ${input.status}.`,
  });

  if (input.status === 'ACTIVE') {
    createNotification({
      userId: user.id,
      parishId: input.parishId ?? null,
      audience: 'PARISH_ADMIN',
      type: 'ACCOUNT_ACTIVATED',
      title: 'Compte activé',
      message: 'Votre compte Missa Paro est désormais actif.',
    });
  }

  return { ok: true, user: sanitizeUser(user) };
}

export function activateAccountWithToken(
  rawToken: string,
  newPassword: string
): { ok: true; user: UserEntity } | { ok: false; status: number; error: string } {
  if (!rawToken || newPassword.length < 8) {
    return {
      ok: false,
      status: 400,
      error: 'Jeton valide et nouveau mot de passe d’au moins 8 caractères requis.',
    };
  }

  const state = getPlatformState();
  const tokenDigest = hashToken(rawToken.trim());
  const user = state.users.find((u) => u.activationTokenHash === tokenDigest);
  if (!user) {
    return { ok: false, status: 404, error: 'Lien d’activation invalide ou déjà utilisé.' };
  }

  if (
    user.activationExpiresAt &&
    new Date(user.activationExpiresAt).getTime() <= Date.now()
  ) {
    return { ok: false, status: 410, error: 'Ce lien d’activation a expiré.' };
  }

  const now = new Date().toISOString();
  user.passwordHash = hashPassword(newPassword);
  user.status = 'ACTIVE';
  user.mustChangePassword = false;
  user.tempPasswordExpiresAt = null;
  user.activationTokenHash = null;
  user.activationExpiresAt = null;
  user.updatedAt = now;
  savePlatformState(state);

  recordAuditLog({
    actorUserId: user.id,
    actorEmail: user.email,
    scope: 'GLOBAL',
    parishId: user.preferredParishId ?? null,
    action: 'ACCOUNT_ACTIVATED_BY_TOKEN',
    targetType: 'USER',
    targetId: user.id,
    summary: `Activation du compte ${user.email} via lien sécurisé.`,
  });

  return { ok: true, user };
}

export function changeOwnPassword(
  userId: string,
  newPassword: string
): { ok: true; user: UserEntity } | { ok: false; status: number; error: string } {
  if (String(newPassword || '').length < 8) {
    return { ok: false, status: 400, error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' };
  }

  const state = getPlatformState();
  const user = state.users.find((u) => u.id === userId);
  if (!user) {
    return { ok: false, status: 404, error: 'Utilisateur introuvable.' };
  }

  const now = new Date().toISOString();
  user.passwordHash = hashPassword(newPassword);
  user.mustChangePassword = false;
  user.tempPasswordExpiresAt = null;
  user.activationTokenHash = null;
  user.activationExpiresAt = null;
  user.status = 'ACTIVE';
  user.updatedAt = now;
  savePlatformState(state);

  recordAuditLog({
    actorUserId: user.id,
    actorEmail: user.email,
    scope: user.isSuperAdmin ? 'GLOBAL' : 'PARISH',
    parishId: user.preferredParishId ?? null,
    action: 'PASSWORD_CHANGED',
    targetType: 'USER',
    targetId: user.id,
    summary: `Renouvellement du mot de passe pour ${user.email}.`,
  });

  return { ok: true, user };
}

export function createOrAttachParishMember(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  displayName: string;
  email: string;
  phone: string;
  roles: RoleCode[];
  titleLabel?: string;
}):
  | {
      ok: true;
      user: SafeUserSummary;
      membership: ParishMembershipEntity;
      temporaryPassword: string | null;
    }
  | { ok: false; status: number; error: string } {
  const cleanEmail = String(input.email || '').trim().toLowerCase();
  const cleanName = String(input.displayName || '').trim().slice(0, 120);
  const validRoles = (input.roles || []).filter((r) => ALL_ROLE_CODES.includes(r));

  if (!cleanEmail || !cleanEmail.includes('@') || cleanName.length < 2) {
    return { ok: false, status: 400, error: 'Nom complet et e-mail valides requis.' };
  }
  if (validRoles.length === 0) {
    return { ok: false, status: 400, error: 'Sélectionnez au moins un rôle paroissial.' };
  }

  const state = getPlatformState();
  const now = new Date().toISOString();
  let user = state.users.find((u) => u.email.toLowerCase() === cleanEmail);

  // Security guard: never allow Parish Admin to modify/attach Super Admin or escalate privileges
  if (user && user.isSuperAdmin) {
    return {
      ok: false,
      status: 403,
      error: 'Un Super Administrateur ne peut pas être rattaché comme membre local.',
    };
  }

  let temporaryPassword: string | null = null;
  if (!user) {
    temporaryPassword = generateTempPassword(14);
    const expiresAt = new Date(
      Date.now() + (state.settings.tempPasswordTtlHours || 48) * 3600 * 1000
    ).toISOString();
    user = {
      id: `user-${crypto.randomUUID().slice(0, 12)}`,
      email: cleanEmail,
      displayName: cleanName,
      phone: String(input.phone || '').trim().slice(0, 40),
      passwordHash: hashPassword(temporaryPassword),
      accountType: 'PARISH_STAFF',
      isSuperAdmin: false,
      status: 'PENDING_ACTIVATION',
      mustChangePassword: true,
      tempPasswordExpiresAt: expiresAt,
      activationTokenHash: null,
      activationExpiresAt: null,
      preferredParishId: input.parishId,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    state.users.push(user);
  }

  let membership = state.memberships.find(
    (m) => m.userId === user.id && m.parishId === input.parishId && m.status !== 'REMOVED'
  );
  if (!membership) {
    membership = {
      id: `mem-${crypto.randomUUID().slice(0, 12)}`,
      userId: user.id,
      parishId: input.parishId,
      status: 'ACTIVE',
      titleLabel:
        input.titleLabel?.trim().slice(0, 80) ||
        validRoles.map((r) => ROLE_CATALOG[r].label).join(' + '),
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorUserId,
    };
    state.memberships.push(membership);
  }
  savePlatformState(state);

  for (const roleCode of validRoles) {
    assignRoleToMembership({
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      parishId: input.parishId,
      membershipId: membership.id,
      roleCode,
    });
  }

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'PARISH_MEMBER_ATTACHED',
    targetType: 'MEMBERSHIP',
    targetId: membership.id,
    summary: `Rattachement de ${user.email} (${validRoles.join(', ')}) à la paroisse.`,
  });

  return { ok: true, user: sanitizeUser(user), membership, temporaryPassword };
}

export function listParishMembersDetailed(parishId: string) {
  const state = getPlatformState();
  return state.memberships
    .filter((m) => m.parishId === parishId && m.status !== 'REMOVED')
    .map((m) => {
      const user = state.users.find((u) => u.id === m.userId);
      if (!user) return null;
      const access = computeEffectiveAccess(user.id, parishId);
      const roleAssignments = state.membershipRoles.filter(
        (mr) => mr.membershipId === m.id && mr.parishId === parishId && mr.status === 'ACTIVE'
      );
      return {
        membership: m,
        user: sanitizeUser(user),
        roles: roleAssignments,
        roleAssignments,
        activeRoles: access?.activeRoles ?? roleAssignments.map((r) => r.roleCode),
        permissions: access?.permissions ?? [],
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

export function updateMembershipStatus(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  membershipId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
}): { ok: true } | { ok: false; status: number; error: string } {
  const state = getPlatformState();
  const membership = state.memberships.find(
    (m) => m.id === input.membershipId && m.parishId === input.parishId
  );
  if (!membership) {
    return { ok: false, status: 404, error: 'Appartenance introuvable.' };
  }

  if (input.status !== 'ACTIVE') {
    const isAdminHere = state.membershipRoles.some(
      (mr) =>
        mr.membershipId === membership.id &&
        mr.roleCode === 'PARISH_ADMIN' &&
        mr.status === 'ACTIVE'
    );
    if (isAdminHere) {
      const activeAdminMemberships = state.membershipRoles.filter((mr) => {
        if (mr.parishId !== input.parishId || mr.roleCode !== 'PARISH_ADMIN' || mr.status !== 'ACTIVE') {
          return false;
        }
        const m = state.memberships.find((mem) => mem.id === mr.membershipId && mem.status === 'ACTIVE');
        const u = state.users.find((usr) => usr.id === mr.userId && usr.status === 'ACTIVE');
        return Boolean(m && u);
      });
      if (activeAdminMemberships.length <= 1) {
        return {
          ok: false,
          status: 409,
          error: 'Impossible de suspendre ou retirer le dernier administrateur paroissial.',
        };
      }
    }
  }

  membership.status = input.status;
  membership.updatedAt = new Date().toISOString();
  savePlatformState(state);

  recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'MEMBERSHIP_STATUS_CHANGED',
    targetType: 'MEMBERSHIP',
    targetId: membership.id,
    summary: `Statut d’appartenance ${membership.id} passé à ${input.status}.`,
  });

  return { ok: true };
}

export function registerPublicFideleAccount(input: {
  displayName: string;
  email: string;
  phone: string;
  password: string;
  provinceId: string;
  dioceseId: string;
  parishId?: string;
}): { ok: true; user: SafeUserSummary } | { ok: false; status: number; error: string } {
  const cleanEmail = String(input.email || '').trim().toLowerCase();
  const cleanName = String(input.displayName || '').trim().slice(0, 120);
  if (!cleanEmail || !cleanEmail.includes('@') || cleanName.length < 2) {
    return { ok: false, status: 400, error: 'Nom complet et e-mail valides requis.' };
  }
  if (!input.password || input.password.length < 6) {
    return { ok: false, status: 400, error: 'Le mot de passe doit contenir au moins 6 caractères.' };
  }

  const state = getPlatformState();
  if (!state.settings.allowPublicFideleSignup) {
    return { ok: false, status: 403, error: 'L’inscription publique des fidèles est actuellement fermée.' };
  }

  if (state.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    return { ok: false, status: 409, error: 'Un compte existe déjà avec cette adresse e-mail.' };
  }

  const now = new Date().toISOString();
  const user: UserEntity = {
    id: `uid-${crypto.randomUUID().slice(0, 12)}`,
    email: cleanEmail,
    displayName: cleanName,
    phone: String(input.phone || '').trim().slice(0, 40),
    passwordHash: hashPassword(input.password),
    accountType: 'FIDELE',
    isSuperAdmin: false,
    status: 'ACTIVE',
    mustChangePassword: false,
    tempPasswordExpiresAt: null,
    activationTokenHash: null,
    activationExpiresAt: null,
    preferredProvinceId: input.provinceId,
    preferredDioceseId: input.dioceseId,
    preferredParishId: input.parishId,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };

  state.users.push(user);
  savePlatformState(state);

  recordAuditLog({
    actorUserId: user.id,
    actorEmail: user.email,
    scope: 'PUBLIC',
    parishId: null,
    action: 'FIDELE_REGISTERED',
    targetType: 'USER',
    targetId: user.id,
    summary: `Inscription d’un compte fidèle (${user.email}).`,
  });

  return { ok: true, user: sanitizeUser(user) };
}
