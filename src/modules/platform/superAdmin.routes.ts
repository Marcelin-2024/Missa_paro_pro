import { Router, Request, Response } from 'express';
import {
  requireSuperAdmin,
  verifyCsrfForSessionMutation,
} from '../auth/auth.middleware.js';
import {
  getAllProvinces,
  listParishRequestsRepo,
} from '../ecclesiastical/ecclesiastical.repository.js';
import { listProvincesSummary, reviewParishRequest } from '../ecclesiastical/ecclesiastical.service.js';
import {
  createParishAdminBySuperAdmin,
  getParishAdminDetails,
  resetAdminAccessBySuperAdmin,
  sanitizeUser,
  updateParishAdminBySuperAdmin,
  updateUserStatus,
} from '../users/users.service.js';
import {
  getParishById,
  provisionOrActivateParish,
  updateParishBySuperAdmin,
  updateParishStatus,
} from '../parishes/parishes.service.js';
import { listAuditLogs, recordAuditLog } from '../audit/audit.service.js';
import { listNotificationsForSuperAdmin } from '../notifications/notifications.service.js';
import {
  applyExceptionalPaymentCorrection,
  getPaymentDetailsForStaff,
  listPaymentsFiltered,
} from '../payments/payments.service.js';
import { computePaymentStatistics } from '../payments/payments.stats.js';
import { PAYMENT_PROVIDERS_META, PAYMENT_STATUS_LABELS } from '../payments/payment.config.js';
import type { ParishStatus, PaymentStatus, UserAccountStatus } from './platform.types.js';
import {
  listAllActiveRolesRepo,
  listAllMembershipsRepo,
  listAllParishesRepo,
  listMembershipsByParishRepo,
} from '../../repositories/parishes.repository.js';
import { listAllUsers } from '../../repositories/users.repository.js';
import {
  countAllIntentionsRepo,
  countIntentionsByParishRepo,
} from '../../repositories/intentions.repository.js';
import { countMessesByParishRepo } from '../../repositories/massesAnnouncements.repository.js';
import {
  getPlatformSettings,
  savePlatformSettings,
} from '../../repositories/system.repository.js';

export const superAdminRouter = Router();
export const superAdminApiRouter = Router();

async function buildSuperAdminStats() {
  const [parishes, users, activeRoles, parishRequests, totalIntentions] = await Promise.all([
    listAllParishesRepo(),
    listAllUsers(),
    listAllActiveRolesRepo(),
    listParishRequestsRepo(),
    countAllIntentionsRepo(),
  ]);

  const parishAdmins = users.filter((u) =>
    activeRoles.some((mr) => mr.userId === u.id && mr.roleCode === 'PARISH_ADMIN')
  );

  return {
    totalParishes: parishes.length,
    activeParishes: parishes.filter((p) => p.status === 'ACTIVE').length,
    pendingParishes: parishes.filter((p) => p.status === 'PENDING_ACTIVATION').length,
    suspendedParishes: parishes.filter((p) => p.status === 'SUSPENDED').length,
    totalParishAdmins: parishAdmins.length,
    pendingAdmins: users.filter((u) => !u.isSuperAdmin && u.status === 'PENDING_ACTIVATION').length,
    totalUsers: users.length,
    totalIntentions,
    pendingParishRequests: parishRequests.filter((r) => r.status === 'PENDING').length,
  };
}

async function getParishAdminList() {
  const [users, memberships, parishes, activeRoles] = await Promise.all([
    listAllUsers(),
    listAllMembershipsRepo(),
    listAllParishesRepo(),
    listAllActiveRolesRepo(),
  ]);
  const parishMap = new Map(parishes.map((p) => [p.id, p]));

  return users
    .filter((u) => !u.isSuperAdmin && u.accountType === 'PARISH_STAFF')
    .map((u) => {
      const userMemberships = memberships
        .filter((m) => m.userId === u.id && m.status !== 'REMOVED')
        .map((m) => {
          const parish = parishMap.get(m.parishId);
          const roles = activeRoles
            .filter((mr) => mr.membershipId === m.id && mr.status === 'ACTIVE')
            .map((mr) => mr.roleCode);
          return {
            membershipId: m.id,
            parishName: parish?.name || m.parishId,
            parishId: m.parishId,
            roles,
          };
        });
      return {
        ...sanitizeUser(u),
        memberships: userMemberships,
      };
    });
}

superAdminRouter.get('/', requireSuperAdmin, async (req: Request, res: Response) => {
  const section = String(req.query.section || 'overview');
  const paymentParishFilter = typeof req.query.parishId === 'string' ? req.query.parishId.trim() : '';
  const paymentQuery = {
    parishId: paymentParishFilter || undefined,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
    page: typeof req.query.page === 'string' ? Number(req.query.page) : 1,
    limit: 10,
  };

  const [
    parishes,
    users,
    stats,
    parishRequests,
    parishAdmins,
    auditLogs,
    recentAudit,
    notifications,
    settings,
    paymentStats,
    paymentList,
  ] = await Promise.all([
    listAllParishesRepo(),
    listAllUsers(),
    buildSuperAdminStats(),
    listParishRequestsRepo(),
    getParishAdminList(),
    listAuditLogs({ scope: 'GLOBAL', limit: 60 }),
    listAuditLogs({ limit: 15 }),
    listNotificationsForSuperAdmin(),
    getPlatformSettings(),
    computePaymentStatistics({
      parishId: paymentParishFilter || undefined,
      dateFrom: paymentQuery.dateFrom,
      dateTo: paymentQuery.dateTo,
    }),
    listPaymentsFiltered(paymentQuery),
  ]);

  res.render('super_admin', {
    section,
    user: req.authContext!.user,
    stats,
    parishes,
    parishAdmins,
    users: users.map(sanitizeUser),
    provinces: listProvincesSummary(),
    directoryProvinces: getAllProvinces(),
    parishRequests,
    auditLogs,
    recentAudit,
    notifications,
    settings,
    paymentStats,
    paymentList,
    paymentFilters: paymentQuery,
    paymentProviders: PAYMENT_PROVIDERS_META,
    paymentStatusLabels: PAYMENT_STATUS_LABELS,
  });
});

superAdminApiRouter.use(requireSuperAdmin);
superAdminApiRouter.use(verifyCsrfForSessionMutation);

superAdminApiRouter.get('/overview', async (_req: Request, res: Response) => {
  const [stats, recentAudit] = await Promise.all([
    buildSuperAdminStats(),
    listAuditLogs({ limit: 20 }),
  ]);
  res.json({ stats, recentAudit });
});

superAdminApiRouter.post('/parishes', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, string>;
  const result = await provisionOrActivateParish({
    actorUserId: actor.id,
    actorEmail: actor.email,
    provinceId: body.provinceId || '',
    dioceseId: body.dioceseId || '',
    directoryParishId: body.directoryParishId || undefined,
    customParishName: body.customParishName || undefined,
    location: body.location || undefined,
    phone: body.phone || undefined,
    email: body.email || undefined,
    address: body.address || undefined,
    massScheduleSummary: body.massScheduleSummary || undefined,
    status: (body.status as ParishStatus) || 'ACTIVE',
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.status(201).json({ success: true, parish: result.parish });
});

superAdminApiRouter.get('/parishes/:id', async (req: Request, res: Response) => {
  const parish = await getParishById(String(req.params.id || ''));
  if (!parish) {
    res.status(404).json({ success: false, error: 'Paroisse introuvable.' });
    return;
  }
  const [intentionsCount, massesCount, memberships] = await Promise.all([
    countIntentionsByParishRepo(parish.id),
    countMessesByParishRepo(parish.id),
    listMembershipsByParishRepo(parish.id),
  ]);
  const staffCount = memberships.filter((m) => m.status === 'ACTIVE').length;
  res.json({ success: true, parish, counts: { intentionsCount, massesCount, staffCount } });
});

superAdminApiRouter.patch('/parishes/:id', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const chapels = Array.isArray(body.chapels)
    ? body.chapels.map(String)
    : typeof body.chapels === 'string'
      ? body.chapels.split(',').map((s) => s.trim())
      : undefined;

  const result = await updateParishBySuperAdmin({
    actorUserId: actor.id,
    actorEmail: actor.email,
    parishId: String(req.params.id || ''),
    name: typeof body.name === 'string' ? body.name : undefined,
    location: typeof body.location === 'string' ? body.location : undefined,
    phone: typeof body.phone === 'string' ? body.phone : undefined,
    email: typeof body.email === 'string' ? body.email : undefined,
    address: typeof body.address === 'string' ? body.address : undefined,
    massScheduleSummary:
      typeof body.massScheduleSummary === 'string' ? body.massScheduleSummary : undefined,
    chapelsEnabled: typeof body.chapelsEnabled === 'boolean' ? body.chapelsEnabled : undefined,
    chapels,
    status: typeof body.status === 'string' ? (body.status.toUpperCase() as ParishStatus) : undefined,
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, parish: result.parish });
});

superAdminApiRouter.patch('/parishes/:id/status', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const status = String((req.body as Record<string, unknown>)?.status || '').toUpperCase() as ParishStatus;
  const result = await updateParishStatus({
    actorUserId: actor.id,
    actorEmail: actor.email,
    parishId: String(req.params.id || ''),
    status,
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, parish: result.parish });
});

superAdminApiRouter.post('/admins', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, string>;
  const result = await createParishAdminBySuperAdmin({
    actorUserId: actor.id,
    actorEmail: actor.email,
    provinceId: body.provinceId || '',
    dioceseId: body.dioceseId || '',
    directoryParishId: body.directoryParishId || undefined,
    customParishName: body.customParishName || undefined,
    displayName: body.displayName || '',
    email: body.email || '',
    phone: body.phone || '',
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.status(201).json({
    success: true,
    user: result.user,
    parishId: result.parishId,
    parishName: result.parishName,
    temporaryPassword: result.temporaryPassword,
    activationLink: `/activer-compte?token=${result.activationToken}`,
    expiresAt: result.expiresAt,
  });
});

superAdminApiRouter.get('/admins/:userId', async (req: Request, res: Response) => {
  const detail = await getParishAdminDetails(String(req.params.userId || ''));
  if (!detail) {
    res.status(404).json({ success: false, error: 'Administrateur introuvable.' });
    return;
  }
  res.json({ success: true, ...detail });
});

superAdminApiRouter.patch('/admins/:userId', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await updateParishAdminBySuperAdmin({
    actorUserId: actor.id,
    actorEmail: actor.email,
    userId: String(req.params.userId || ''),
    displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
    phone: typeof body.phone === 'string' ? body.phone : undefined,
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, user: result.user });
});

superAdminApiRouter.patch('/admins/:userId/status', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const status = String((req.body as Record<string, unknown>)?.status || '').toUpperCase() as UserAccountStatus;
  const result = await updateUserStatus({
    actorUserId: actor.id,
    actorEmail: actor.email,
    userId: String(req.params.userId || ''),
    status,
    scope: 'GLOBAL',
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, user: result.user });
});

superAdminApiRouter.post('/admins/:userId/reset-access', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const result = await resetAdminAccessBySuperAdmin({
    actorUserId: actor.id,
    actorEmail: actor.email,
    userId: String(req.params.userId || ''),
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.json({
    success: true,
    temporaryPassword: result.temporaryPassword,
    activationLink: `/activer-compte?token=${result.activationToken}`,
    expiresAt: result.expiresAt,
  });
});

superAdminApiRouter.patch('/parish-requests/:id', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = String(body.decision || '').trim().toUpperCase();
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    res.status(400).json({ success: false, error: 'Décision invalide.' });
    return;
  }

  const result = await reviewParishRequest({
    requestId: String(req.params.id || ''),
    decision,
    adminDecisionNote: typeof body.adminDecisionNote === 'string' ? body.adminDecisionNote : undefined,
  });

  if (!result.ok) {
    res.status(result.statusCode).json({ success: false, error: result.error });
    return;
  }

  if (decision === 'APPROVED') {
    await provisionOrActivateParish({
      actorUserId: actor.id,
      actorEmail: actor.email,
      provinceId: result.request.provinceId,
      dioceseId: result.request.dioceseId,
      customParishName: result.request.parishName,
      status: 'PENDING_ACTIVATION',
    });
  }

  await recordAuditLog({
    actorUserId: actor.id,
    actorEmail: actor.email,
    scope: 'GLOBAL',
    parishId: null,
    action: `PARISH_REQUEST_${decision}`,
    targetType: 'PARISH_REQUEST',
    targetId: result.request.id,
    summary: `Demande de paroisse « ${result.request.parishName} » : ${decision}.`,
  });

  res.json({ success: true, request: result.request });
});

superAdminApiRouter.post('/settings', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const settings = await getPlatformSettings();
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (typeof body.platformName === 'string' && body.platformName.trim()) {
    settings.platformName = body.platformName.trim().slice(0, 100);
  }
  if (typeof body.supportEmail === 'string' && body.supportEmail.trim()) {
    settings.supportEmail = body.supportEmail.trim().slice(0, 120);
  }
  if (
    typeof body.tempPasswordTtlHours === 'number' ||
    typeof body.tempPasswordTtlHours === 'string'
  ) {
    const ttl = Number(body.tempPasswordTtlHours);
    if (Number.isFinite(ttl) && ttl >= 1 && ttl <= 168) {
      settings.tempPasswordTtlHours = ttl;
      settings.activationLinkTtlHours = ttl;
    }
  }
  settings.allowPublicFideleSignup = Boolean(body.allowPublicFideleSignup);
  settings.requireCureAnnouncementApproval = Boolean(body.requireCureAnnouncementApproval);
  await savePlatformSettings(settings);

  await recordAuditLog({
    actorUserId: actor.id,
    actorEmail: actor.email,
    scope: 'GLOBAL',
    parishId: null,
    action: 'PLATFORM_SETTINGS_UPDATED',
    targetType: 'SETTINGS',
    targetId: 'global',
    summary: 'Mise à jour des paramètres globaux de la plateforme.',
  });

  res.json({ success: true, settings });
});

superAdminApiRouter.get('/payments/statistics', async (req: Request, res: Response) => {
  const parishId = typeof req.query.parishId === 'string' ? req.query.parishId : undefined;
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
  const statistics = await computePaymentStatistics({ parishId, dateFrom, dateTo });
  res.json({ success: true, statistics });
});

superAdminApiRouter.get('/payments', async (req: Request, res: Response) => {
  const result = await listPaymentsFiltered({
    parishId: typeof req.query.parishId === 'string' ? req.query.parishId : undefined,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
    page: typeof req.query.page === 'string' ? Number(req.query.page) : 1,
    limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 10,
  });
  res.json({
    success: true,
    statusLabels: PAYMENT_STATUS_LABELS,
    providers: PAYMENT_PROVIDERS_META,
    ...result,
  });
});

superAdminApiRouter.get('/payments/:id', async (req: Request, res: Response) => {
  const detail = await getPaymentDetailsForStaff(String(req.params.id || ''), null);
  if (!detail) {
    res.status(404).json({ success: false, error: 'Transaction introuvable.' });
    return;
  }
  res.json({ success: true, ...detail });
});

superAdminApiRouter.post('/payments/:id/correction', async (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await applyExceptionalPaymentCorrection({
    actorUserId: actor.id,
    actorEmail: actor.email,
    paymentId: String(req.params.id || ''),
    nextStatus: String(body.nextStatus || '').toUpperCase() as PaymentStatus,
    reason: String(body.reason || ''),
  });
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, payment: result.payment });
});
