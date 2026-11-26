import crypto from 'crypto';
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
import { ALL_ROLE_CODES, PERMISSION_LABELS, ROLE_CATALOG } from '../roles/rbac.catalog.js';
import { assignRoleToMembership, computeEffectiveAccess } from '../roles/rbac.service.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import { provisionOrActivateParish } from '../parishes/parishes.service.js';
import {
  getPlatformSettings,
  getSystemMetadata,
  saveSystemMetadata,
} from '../../repositories/system.repository.js';
import {
  findSuperAdminUsers,
  findUserByActivationTokenHash,
  findUserByEmail,
  findUserById,
  listAllUsers,
  saveUser,
} from '../../repositories/users.repository.js';
import {
  findActiveMembershipRepo,
  findMembershipByIdRepo,
  listAllParishesRepo,
  listMembershipRolesByParishRepo,
  listMembershipsByParishRepo,
  listMembershipsByUserRepo,
  saveMembershipRepo,
} from '../../repositories/parishes.repository.js';

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

export async function authenticateWithCredentials(
  email: string,
  password: string
): Promise<
  | { ok: true; user: UserEntity }
  | { ok: false; code: string; message: string }
> {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const [user, meta] = await Promise.all([findUserByEmail(cleanEmail), getSystemMetadata()]);

  if (!user) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' };
  }

  if (!user.passwordHash) {
    if (user.isSuperAdmin && !meta.superAdminClaimed) {
      return {
        ok: false,
        code: 'SUPER_ADMIN_SETUP_REQUIRED',
        message:
          'Ce serveur déployé n’a pas encore de mot de passe Super Administrateur initialisé.',
      };
    }
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
    const [memberships, parishes] = await Promise.all([
      listMembershipsByUserRepo(user.id),
      listAllParishesRepo(),
    ]);
    const parishMap = new Map(parishes.map((p) => [p.id, p]));
    const hasActiveMembership = memberships.some((m) => {
      if (m.status !== 'ACTIVE') return false;
      const parish = parishMap.get(m.parishId);
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
  await saveUser(user);

  return { ok: true, user };
}

export async function claimInitialSuperAdminPassword(
  email: string,
  newPassword: string
): Promise<{ ok: true; user: UserEntity } | { ok: false; status: number; error: string }> {
  const [meta, superAdmins] = await Promise.all([getSystemMetadata(), findSuperAdminUsers()]);
  if (meta.superAdminClaimed || superAdmins.some((u) => Boolean(u.passwordHash))) {
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
  const configuredSaEmail = (process.env.SUPER_ADMIN_EMAIL || 'settaocram@gmail.com')
    .trim()
    .toLowerCase();

  let superAdmin = superAdmins.find((u) => u.email.toLowerCase() === cleanEmail);
  if (!superAdmin && cleanEmail === configuredSaEmail) {
    const nowInit = new Date().toISOString();
    superAdmin = {
      id: 'user-super-admin-1',
      email: configuredSaEmail,
      displayName: 'Super Administrateur Missa Paro',
      phone: '+225 0100000000',
      passwordHash: null,
      accountType: 'SUPER_ADMIN',
      isSuperAdmin: true,
      status: 'ACTIVE',
      mustChangePassword: false,
      tempPasswordExpiresAt: null,
      activationTokenHash: null,
      activationExpiresAt: null,
      createdAt: nowInit,
      updatedAt: nowInit,
      lastLoginAt: null,
    };
  }

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

  await saveUser(superAdmin);
  await saveSystemMetadata({
    ...meta,
    version: meta.version || 1,
    superAdminClaimed: true,
    bootstrappedAt: meta.bootstrappedAt || now,
  });

  await recordAuditLog({
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

export async function createParishAdminBySuperAdmin(input: {
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
}): Promise<
  | {
      ok: true;
      user: SafeUserSummary;
      parishId: string;
      parishName: string;
      temporaryPassword: string;
      activationToken: string;
      expiresAt: string;
    }
  | { ok: false; status: number; error: string }
> {
  const cleanEmail = String(input.email || '').trim().toLowerCase();
  const cleanName = String(input.displayName || '').trim().slice(0, 120);
  if (!cleanEmail || !cleanEmail.includes('@') || cleanName.length < 2) {
    return { ok: false, status: 400, error: 'Nom complet et adresse e-mail valides requis.' };
  }

  const parishResult = await provisionOrActivateParish({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    provinceId: input.provinceId,
    dioceseId: input.dioceseId,
    directoryParishId: input.directoryParishId,
    customParishName: input.customParishName,
    status: 'ACTIVE',
  });
  if (!parishResult.ok) return parishResult;

  const settings = await getPlatformSettings();
  const now = new Date().toISOString();
  const ttlHours = input.tempPasswordTtlHours ?? settings.tempPasswordTtlHours ?? 48;
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  const temporaryPassword = input.customTempPassword?.trim() || generateTempPassword(14);
  const { rawToken, tokenHash } = generateActivationToken();

  let user = await findUserByEmail(cleanEmail);
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
  } else {
    user.displayName = cleanName;
    if (String(input.phone || '').trim()) {
      user.phone = String(input.phone).trim().slice(0, 40);
    }
    user.accountType = 'PARISH_STAFF';
    user.passwordHash = hashPassword(temporaryPassword);
    user.mustChangePassword = true;
    user.tempPasswordExpiresAt = expiresAt;
    user.activationTokenHash = tokenHash;
    user.activationExpiresAt = expiresAt;
    user.updatedAt = now;
  }
  await saveUser(user);

  let membership = await findActiveMembershipRepo(user.id, parishResult.parish.id);
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
    await saveMembershipRepo(membership);
  }

  await assignRoleToMembership({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    parishId: parishResult.parish.id,
    membershipId: membership.id,
    roleCode: 'PARISH_ADMIN',
  });

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'GLOBAL',
    parishId: parishResult.parish.id,
    action: 'PARISH_ADMIN_CREATED',
    targetType: 'USER',
    targetId: user.id,
    summary: `Création de l’administrateur paroissial ${user.email} pour ${parishResult.parish.name}.`,
  });

  await createNotification({
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

export async function resetAdminAccessBySuperAdmin(input: {
  actorUserId: string;
  actorEmail: string;
  userId: string;
  ttlHours?: number;
}): Promise<
  | { ok: true; temporaryPassword: string; activationToken: string; expiresAt: string }
  | { ok: false; status: number; error: string }
> {
  const [user, settings] = await Promise.all([
    findUserById(input.userId),
    getPlatformSettings(),
  ]);
  if (!user || user.isSuperAdmin) {
    return { ok: false, status: 404, error: 'Administrateur introuvable.' };
  }

  const ttlHours = input.ttlHours ?? settings.tempPasswordTtlHours ?? 48;
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  const temporaryPassword = generateTempPassword(14);
  const { rawToken, tokenHash } = generateActivationToken();

  user.passwordHash = hashPassword(temporaryPassword);
  user.mustChangePassword = true;
  user.tempPasswordExpiresAt = expiresAt;
  user.activationTokenHash = tokenHash;
  user.activationExpiresAt = expiresAt;
  user.updatedAt = new Date().toISOString();
  await saveUser(user);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'GLOBAL',
    parishId: user.preferredParishId ?? null,
    action: 'PARISH_ADMIN_ACCESS_RESET',
    targetType: 'USER',
    targetId: user.id,
    summary: `Réinitialisation d’accès pour ${user.email}.`,
  });

  await createNotification({
    userId: user.id,
    parishId: user.preferredParishId ?? null,
    audience: 'PARISH_ADMIN',
    type: 'PASSWORD_RESET_REQUIRED',
    title: 'Renouvellement de mot de passe requis',
    message: 'Un nouvel accès temporaire a été généré par le Super Administrateur.',
  });

  return { ok: true, temporaryPassword, activationToken: rawToken, expiresAt };
}

export async function updateUserStatus(input: {
  actorUserId: string;
  actorEmail: string;
  userId: string;
  status: UserAccountStatus;
  scope: 'GLOBAL' | 'PARISH';
  parishId?: string | null;
}): Promise<{ ok: true; user: SafeUserSummary } | { ok: false; status: number; error: string }> {
  const allowed: UserAccountStatus[] = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DISABLED'];
  if (!allowed.includes(input.status)) {
    return { ok: false, status: 400, error: 'Statut de compte invalide.' };
  }

  const user = await findUserById(input.userId);
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
  await saveUser(user);

  await recordAuditLog({
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
    await createNotification({
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

export async function activateAccountWithToken(
  rawToken: string,
  newPassword: string
): Promise<{ ok: true; user: UserEntity } | { ok: false; status: number; error: string }> {
  if (!rawToken || newPassword.length < 8) {
    return {
      ok: false,
      status: 400,
      error: 'Jeton valide et nouveau mot de passe d’au moins 8 caractères requis.',
    };
  }

  const tokenDigest = hashToken(rawToken.trim());
  const user = await findUserByActivationTokenHash(tokenDigest);
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
  await saveUser(user);

  await recordAuditLog({
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

export async function changeOwnPassword(
  userId: string,
  newPassword: string
): Promise<{ ok: true; user: UserEntity } | { ok: false; status: number; error: string }> {
  if (String(newPassword || '').length < 8) {
    return {
      ok: false,
      status: 400,
      error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.',
    };
  }

  const user = await findUserById(userId);
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
  await saveUser(user);

  await recordAuditLog({
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

export async function createOrAttachParishMember(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  displayName: string;
  email: string;
  phone: string;
  roles: RoleCode[];
  titleLabel?: string;
}): Promise<
  | {
      ok: true;
      user: SafeUserSummary;
      membership: ParishMembershipEntity;
      temporaryPassword: string | null;
    }
  | { ok: false; status: number; error: string }
> {
  const cleanEmail = String(input.email || '').trim().toLowerCase();
  const cleanName = String(input.displayName || '').trim().slice(0, 120);
  const validRoles = (input.roles || []).filter((r) => ALL_ROLE_CODES.includes(r));

  if (!cleanEmail || !cleanEmail.includes('@') || cleanName.length < 2) {
    return { ok: false, status: 400, error: 'Nom complet et e-mail valides requis.' };
  }
  if (validRoles.length === 0) {
    return { ok: false, status: 400, error: 'Sélectionnez au moins un rôle paroissial.' };
  }

  const [existingUser, settings] = await Promise.all([
    findUserByEmail(cleanEmail),
    getPlatformSettings(),
  ]);
  const now = new Date().toISOString();
  let user = existingUser;

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
      Date.now() + (settings.tempPasswordTtlHours || 48) * 3600 * 1000
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
  } else {
    if (String(input.phone || '').trim()) {
      user.phone = String(input.phone).trim().slice(0, 40);
    }
    if (user.status === 'PENDING_ACTIVATION') {
      user.displayName = cleanName;
    }
    user.updatedAt = now;
  }
  await saveUser(user);

  let membership = await findActiveMembershipRepo(user.id, input.parishId);
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
    await saveMembershipRepo(membership);
  } else if (typeof input.titleLabel === 'string' && input.titleLabel.trim()) {
    membership.titleLabel = input.titleLabel.trim().slice(0, 80);
    membership.updatedAt = now;
    await saveMembershipRepo(membership);
  }

  for (const roleCode of validRoles) {
    await assignRoleToMembership({
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      parishId: input.parishId,
      membershipId: membership.id,
      roleCode,
    });
  }

  await recordAuditLog({
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

export async function listParishMembersDetailed(parishId: string) {
  const [memberships, users, parishRoles] = await Promise.all([
    listMembershipsByParishRepo(parishId),
    listAllUsers(),
    listMembershipRolesByParishRepo(parishId),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const detailed = await Promise.all(
    memberships
      .filter((m) => m.status !== 'REMOVED')
      .map(async (m) => {
        const user = userMap.get(m.userId);
        if (!user) return null;
        const access = await computeEffectiveAccess(user.id, parishId);
        const roleAssignments = parishRoles.filter(
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
  );

  return detailed.filter((item): item is NonNullable<typeof item> => item !== null);
}

export async function getParishMemberDetails(parishId: string, membershipId: string) {
  const members = await listParishMembersDetailed(parishId);
  const member = members.find((m) => m.membership.id === membershipId);
  if (!member) return null;
  return {
    ...member,
    roleLabels: member.activeRoles.map((code) => ({
      code,
      label: ROLE_CATALOG[code]?.label || code,
    })),
    permissionDetails: member.permissions.map((code) => ({
      code,
      label: PERMISSION_LABELS[code] || code,
    })),
  };
}

export async function getParishAdminDetails(userId: string) {
  const user = await findUserById(userId);
  if (!user || user.isSuperAdmin) return null;

  const [rawMemberships, parishes] = await Promise.all([
    listMembershipsByUserRepo(user.id),
    listAllParishesRepo(),
  ]);
  const parishMap = new Map(parishes.map((p) => [p.id, p]));

  const memberships = await Promise.all(
    rawMemberships
      .filter((m) => m.status !== 'REMOVED')
      .map(async (m) => {
        const parish = parishMap.get(m.parishId);
        const access = await computeEffectiveAccess(user.id, m.parishId);
        const activeRoles = access?.activeRoles ?? [];
        const permissions = access?.permissions ?? [];
        return {
          membershipId: m.id,
          parishId: m.parishId,
          parishName: parish?.name || m.parishId,
          parishLocation: parish?.location || '',
          parishStatus: parish?.status || 'ACTIVE',
          membershipStatus: m.status,
          titleLabel: m.titleLabel,
          roles: activeRoles.map((code) => ({
            code,
            label: ROLE_CATALOG[code]?.label || code,
          })),
          permissions: permissions.map((code) => ({
            code,
            label: PERMISSION_LABELS[code] || code,
          })),
        };
      })
  );

  return {
    user: sanitizeUser(user),
    memberships,
  };
}

export async function updateParishMemberByParishAdmin(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  membershipId: string;
  displayName?: string;
  phone?: string;
  titleLabel?: string;
}): Promise<
  | { ok: true; member: NonNullable<Awaited<ReturnType<typeof getParishMemberDetails>>> }
  | { ok: false; status: number; error: string }
> {
  const membership = await findMembershipByIdRepo(input.membershipId);
  if (!membership || membership.parishId !== input.parishId || membership.status === 'REMOVED') {
    return { ok: false, status: 404, error: 'Membre introuvable dans cette paroisse.' };
  }

  const user = await findUserById(membership.userId);
  if (!user || user.isSuperAdmin) {
    return { ok: false, status: 403, error: 'Modification non autorisée sur ce compte.' };
  }

  if (typeof input.displayName === 'string') {
    const cleanName = input.displayName.trim().slice(0, 120);
    if (cleanName.length < 2) {
      return {
        ok: false,
        status: 400,
        error: 'Le nom complet doit contenir au moins 2 caractères.',
      };
    }
    user.displayName = cleanName;
  }

  if (typeof input.phone === 'string') {
    user.phone = input.phone.trim().slice(0, 40);
  }

  if (typeof input.titleLabel === 'string') {
    membership.titleLabel = input.titleLabel.trim().slice(0, 80);
  }

  const now = new Date().toISOString();
  user.updatedAt = now;
  membership.updatedAt = now;
  await Promise.all([saveUser(user), saveMembershipRepo(membership)]);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'PARISH',
    parishId: input.parishId,
    action: 'PARISH_MEMBER_UPDATED',
    targetType: 'MEMBERSHIP',
    targetId: membership.id,
    summary: `Mise à jour du membre ${user.displayName} (${user.email}).`,
  });

  const updated = await getParishMemberDetails(input.parishId, membership.id);
  if (!updated) {
    return { ok: false, status: 404, error: 'Membre introuvable.' };
  }
  return { ok: true, member: updated };
}

export async function updateParishAdminBySuperAdmin(input: {
  actorUserId: string;
  actorEmail: string;
  userId: string;
  displayName?: string;
  phone?: string;
}): Promise<{ ok: true; user: SafeUserSummary } | { ok: false; status: number; error: string }> {
  const user = await findUserById(input.userId);
  if (!user || user.isSuperAdmin) {
    return { ok: false, status: 404, error: 'Compte administrateur introuvable.' };
  }

  if (typeof input.displayName === 'string') {
    const cleanName = input.displayName.trim().slice(0, 120);
    if (cleanName.length < 2) {
      return {
        ok: false,
        status: 400,
        error: 'Le nom complet doit contenir au moins 2 caractères.',
      };
    }
    user.displayName = cleanName;
  }

  if (typeof input.phone === 'string') {
    user.phone = input.phone.trim().slice(0, 40);
  }

  user.updatedAt = new Date().toISOString();
  await saveUser(user);

  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    scope: 'GLOBAL',
    parishId: user.preferredParishId ?? null,
    action: 'PARISH_ADMIN_UPDATED',
    targetType: 'USER',
    targetId: user.id,
    summary: `Mise à jour du responsable ${user.displayName} (${user.email}).`,
  });

  return { ok: true, user: sanitizeUser(user) };
}

export async function updateMembershipStatus(input: {
  actorUserId: string;
  actorEmail: string;
  parishId: string;
  membershipId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const membership = await findMembershipByIdRepo(input.membershipId);
  if (!membership || membership.parishId !== input.parishId) {
    return { ok: false, status: 404, error: 'Appartenance introuvable.' };
  }

  if (input.status !== 'ACTIVE') {
    const [parishRoles, parishMemberships] = await Promise.all([
      listMembershipRolesByParishRepo(input.parishId),
      listMembershipsByParishRepo(input.parishId),
    ]);

    const isAdminHere = parishRoles.some(
      (mr) =>
        mr.membershipId === membership.id &&
        mr.roleCode === 'PARISH_ADMIN' &&
        mr.status === 'ACTIVE'
    );
    if (isAdminHere) {
      const activeMembershipIds = new Set(
        parishMemberships.filter((mem) => mem.status === 'ACTIVE').map((mem) => mem.id)
      );
      const otherAdmins = parishRoles.filter(
        (mr) =>
          mr.membershipId !== membership.id &&
          mr.roleCode === 'PARISH_ADMIN' &&
          mr.status === 'ACTIVE' &&
          activeMembershipIds.has(mr.membershipId)
      );

      let activeAdminCount = 0;
      for (const mr of otherAdmins) {
        const u = await findUserById(mr.userId);
        if (u && u.status === 'ACTIVE') {
          activeAdminCount += 1;
        }
      }

      if (activeAdminCount === 0) {
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
  await saveMembershipRepo(membership);

  await recordAuditLog({
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

export async function registerPublicFideleAccount(input: {
  displayName: string;
  email: string;
  phone: string;
  password: string;
  provinceId: string;
  dioceseId: string;
  parishId?: string;
}): Promise<{ ok: true; user: SafeUserSummary } | { ok: false; status: number; error: string }> {
  const cleanEmail = String(input.email || '').trim().toLowerCase();
  const cleanName = String(input.displayName || '').trim().slice(0, 120);
  if (!cleanEmail || !cleanEmail.includes('@') || cleanName.length < 2) {
    return { ok: false, status: 400, error: 'Nom complet et e-mail valides requis.' };
  }
  if (!input.password || input.password.length < 6) {
    return { ok: false, status: 400, error: 'Le mot de passe doit contenir au moins 6 caractères.' };
  }

  const [settings, existing] = await Promise.all([
    getPlatformSettings(),
    findUserByEmail(cleanEmail),
  ]);
  if (!settings.allowPublicFideleSignup) {
    return {
      ok: false,
      status: 403,
      error: 'L’inscription publique des fidèles est actuellement fermée.',
    };
  }

  if (existing) {
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

  await saveUser(user);

  await recordAuditLog({
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
