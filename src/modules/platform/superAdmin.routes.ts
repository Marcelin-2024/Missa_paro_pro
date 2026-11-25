import { Router, Request, Response } from 'express';
import {
  requireSuperAdmin,
  verifyCsrfForSessionMutation,
} from '../auth/auth.middleware.js';
import { getPlatformState, savePlatformState } from './platform.repository.js';
import { getAllProvinces, readParishRequests } from '../ecclesiastical/ecclesiastical.repository.js';
import { listProvincesSummary, reviewParishRequest } from '../ecclesiastical/ecclesiastical.service.js';
import {
  createParishAdminBySuperAdmin,
  resetAdminAccessBySuperAdmin,
  sanitizeUser,
  updateUserStatus,
} from '../users/users.service.js';
import { provisionOrActivateParish, updateParishStatus } from '../parishes/parishes.service.js';
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

export const superAdminRouter = Router();
export const superAdminApiRouter = Router();

function buildSuperAdminStats() {
  const state = getPlatformState();
  const parishes = state.parishes;
  const parishAdmins = state.users.filter((u) =>
    state.membershipRoles.some(
      (mr) => mr.userId === u.id && mr.roleCode === 'PARISH_ADMIN' && mr.status === 'ACTIVE'
    )
  );
  const parishRequests = readParishRequests();

  return {
    totalParishes: parishes.length,
    activeParishes: parishes.filter((p) => p.status === 'ACTIVE').length,
    pendingParishes: parishes.filter((p) => p.status === 'PENDING_ACTIVATION').length,
    suspendedParishes: parishes.filter((p) => p.status === 'SUSPENDED').length,
    totalParishAdmins: parishAdmins.length,
    pendingAdmins: state.users.filter((u) => !u.isSuperAdmin && u.status === 'PENDING_ACTIVATION').length,
    totalUsers: state.users.length,
    totalIntentions: state.intentions.length,
    pendingParishRequests: parishRequests.filter((r) => r.status === 'PENDING').length,
  };
}

function getParishAdminList() {
  const state = getPlatformState();
  return state.users
    .filter((u) => !u.isSuperAdmin && u.accountType === 'PARISH_STAFF')
    .map((u) => {
      const memberships = state.memberships
        .filter((m) => m.userId === u.id && m.status !== 'REMOVED')
        .map((m) => {
          const parish = state.parishes.find((p) => p.id === m.parishId);
          const roles = state.membershipRoles
            .filter((mr) => mr.membershipId === m.id && mr.status === 'ACTIVE')
            .map((mr) => mr.roleCode);
          return { membershipId: m.id, parishName: parish?.name || m.parishId, parishId: m.parishId, roles };
        });
      return {
        ...sanitizeUser(u),
        memberships,
      };
    });
}

superAdminRouter.get('/', requireSuperAdmin, (req: Request, res: Response) => {
  const section = String(req.query.section || 'overview');
  const state = getPlatformState();
  const stats = buildSuperAdminStats();
  const provinces = listProvincesSummary();
  const directoryProvinces = getAllProvinces();
  const parishRequests = readParishRequests();
  const parishAdmins = getParishAdminList();
  const auditLogs = listAuditLogs({ scope: 'GLOBAL', limit: 60 });
  const recentAudit = listAuditLogs({ limit: 15 });
  const notifications = listNotificationsForSuperAdmin();

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
  const paymentStats = computePaymentStatistics({
    parishId: paymentParishFilter || undefined,
    dateFrom: paymentQuery.dateFrom,
    dateTo: paymentQuery.dateTo,
  });
  const paymentList = listPaymentsFiltered(paymentQuery);

  res.render('super_admin', {
    section,
    user: req.authContext!.user,
    stats,
    parishes: state.parishes,
    parishAdmins,
    users: state.users.map(sanitizeUser),
    provinces,
    directoryProvinces,
    parishRequests,
    auditLogs,
    recentAudit,
    notifications,
    settings: state.settings,
    paymentStats,
    paymentList,
    paymentFilters: paymentQuery,
    paymentProviders: PAYMENT_PROVIDERS_META,
    paymentStatusLabels: PAYMENT_STATUS_LABELS,
  });
});

superAdminApiRouter.use(requireSuperAdmin);
superAdminApiRouter.use(verifyCsrfForSessionMutation);

superAdminApiRouter.get('/overview', (_req: Request, res: Response) => {
  res.json({
    stats: buildSuperAdminStats(),
    recentAudit: listAuditLogs({ limit: 20 }),
  });
});

superAdminApiRouter.post('/parishes', (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, string>;
  const result = provisionOrActivateParish({
    actorUserId: actor.id,
    actorEmail: actor.email,
    provinceId: body.provinceId || '',
    dioceseId: body.dioceseId || '',
    directoryParishId: body.directoryParishId || undefined,
    customParishName: body.customParishName || undefined,
    location: body.location || undefined,
    status: (body.status as ParishStatus) || 'ACTIVE',
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.status(201).json({ success: true, parish: result.parish });
});

superAdminApiRouter.patch('/parishes/:id/status', (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const status = String((req.body as Record<string, unknown>)?.status || '').toUpperCase() as ParishStatus;
  const result = updateParishStatus({
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

superAdminApiRouter.post('/admins', (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, string>;
  const result = createParishAdminBySuperAdmin({
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

superAdminApiRouter.patch('/admins/:userId/status', (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const status = String((req.body as Record<string, unknown>)?.status || '').toUpperCase() as UserAccountStatus;
  const result = updateUserStatus({
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

superAdminApiRouter.post('/admins/:userId/reset-access', (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const result = resetAdminAccessBySuperAdmin({
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

superAdminApiRouter.patch('/parish-requests/:id', (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = String(body.decision || '').trim().toUpperCase();
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    res.status(400).json({ success: false, error: 'Décision invalide.' });
    return;
  }

  const result = reviewParishRequest({
    requestId: String(req.params.id || ''),
    decision,
    adminDecisionNote: typeof body.adminDecisionNote === 'string' ? body.adminDecisionNote : undefined,
  });

  if (!result.ok) {
    res.status(result.statusCode).json({ success: false, error: result.error });
    return;
  }

  if (decision === 'APPROVED') {
    provisionOrActivateParish({
      actorUserId: actor.id,
      actorEmail: actor.email,
      provinceId: result.request.provinceId,
      dioceseId: result.request.dioceseId,
      customParishName: result.request.parishName,
      status: 'PENDING_ACTIVATION',
    });
  }

  recordAuditLog({
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

superAdminApiRouter.post('/settings', (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const state = getPlatformState();
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (typeof body.platformName === 'string' && body.platformName.trim()) {
    state.settings.platformName = body.platformName.trim().slice(0, 100);
  }
  if (typeof body.supportEmail === 'string' && body.supportEmail.trim()) {
    state.settings.supportEmail = body.supportEmail.trim().slice(0, 120);
  }
  if (typeof body.tempPasswordTtlHours === 'number' || typeof body.tempPasswordTtlHours === 'string') {
    const ttl = Number(body.tempPasswordTtlHours);
    if (Number.isFinite(ttl) && ttl >= 1 && ttl <= 168) {
      state.settings.tempPasswordTtlHours = ttl;
      state.settings.activationLinkTtlHours = ttl;
    }
  }
  state.settings.allowPublicFideleSignup = Boolean(body.allowPublicFideleSignup);
  state.settings.requireCureAnnouncementApproval = Boolean(body.requireCureAnnouncementApproval);
  savePlatformState(state);

  recordAuditLog({
    actorUserId: actor.id,
    actorEmail: actor.email,
    scope: 'GLOBAL',
    parishId: null,
    action: 'PLATFORM_SETTINGS_UPDATED',
    targetType: 'SETTINGS',
    targetId: 'global',
    summary: 'Mise à jour des paramètres globaux de la plateforme.',
  });

  res.json({ success: true, settings: state.settings });
});

superAdminApiRouter.get('/payments/statistics', (req: Request, res: Response) => {
  const parishId = typeof req.query.parishId === 'string' ? req.query.parishId : undefined;
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
  const statistics = computePaymentStatistics({ parishId, dateFrom, dateTo });
  res.json({ success: true, statistics });
});

superAdminApiRouter.get('/payments', (req: Request, res: Response) => {
  const result = listPaymentsFiltered({
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

superAdminApiRouter.get('/payments/:id', (req: Request, res: Response) => {
  const detail = getPaymentDetailsForStaff(String(req.params.id || ''), null);
  if (!detail) {
    res.status(404).json({ success: false, error: 'Transaction introuvable.' });
    return;
  }
  res.json({ success: true, ...detail });
});

superAdminApiRouter.post('/payments/:id/correction', (req: Request, res: Response) => {
  const actor = req.authContext!.user;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = applyExceptionalPaymentCorrection({
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
