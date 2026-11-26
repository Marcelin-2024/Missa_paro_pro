import { Router, Request, Response } from 'express';
import {
  requireParishContext,
  requireParishPermission,
} from '../modules/auth/auth.middleware.js';
import { buildParishDashboardData } from './pageRoutes.js';
import { listParishMembersDetailed } from '../modules/users/users.service.js';
import { listAuditLogs } from '../modules/audit/audit.service.js';
import { ALL_ROLE_CODES, PERMISSION_LABELS, ROLE_CATALOG } from '../modules/roles/rbac.catalog.js';
import { listNotificationsForParish } from '../modules/notifications/notifications.service.js';
import {
  PAYMENT_PROVIDERS_META,
  PAYMENT_STATUS_LABELS,
} from '../modules/payments/payment.config.js';
import { listPaymentsFiltered } from '../modules/payments/payments.service.js';
import { computePaymentStatistics } from '../modules/payments/payments.stats.js';

export const refreshRouter = Router();

refreshRouter.use(requireParishContext);

async function buildCommonLocals(req: Request) {
  const ctx = req.authContext!;
  const parishId = ctx.activeParish!.id;
  const canViewPayments = ctx.permissions.includes('parish.payments.view');
  const paymentFilters = {
    q: typeof req.query.q === 'string' ? req.query.q : '',
    provider: typeof req.query.provider === 'string' ? req.query.provider : '',
    status: typeof req.query.status === 'string' ? req.query.status : '',
    dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '',
    dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : '',
    page: typeof req.query.page === 'string' ? Number(req.query.page) : 1,
    limit: 10,
  };

  const [stats, members, auditLogs, notifications, paymentStats, paymentList] = await Promise.all([
    buildParishDashboardData(parishId),
    ctx.permissions.includes('parish.users.view')
      ? listParishMembersDetailed(parishId)
      : Promise.resolve([]),
    ctx.permissions.includes('parish.audit.view')
      ? listAuditLogs({ scope: 'PARISH', parishId, limit: 40 })
      : Promise.resolve([]),
    listNotificationsForParish(parishId, ctx.user.id),
    canViewPayments ? computePaymentStatistics({ parishId }) : Promise.resolve(null),
    canViewPayments
      ? listPaymentsFiltered({ parishId, ...paymentFilters })
      : Promise.resolve(null),
  ]);

  return {
    user: {
      uid: ctx.user.id,
      nom_complet: ctx.user.displayName,
      paroisse: ctx.activeParish!.name,
      email: ctx.user.email,
    },
    activeParish: ctx.activeParish!,
    activeRoles: ctx.activeRoles,
    permissions: ctx.permissions,
    memberships: ctx.memberships,
    roleCatalog: ROLE_CATALOG,
    roleCodes: ALL_ROLE_CODES,
    permissionLabels: PERMISSION_LABELS,
    stats,
    members,
    auditLogs,
    notifications,
    paymentStats,
    paymentList,
    paymentFilters,
    paymentProviders: PAYMENT_PROVIDERS_META,
    paymentStatusLabels: PAYMENT_STATUS_LABELS,
  };
}

refreshRouter.get(
  '/refresh_firt',
  requireParishPermission('parish.dashboard.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/contenue1', await buildCommonLocals(req));
  }
);

refreshRouter.get(
  '/refresh_second',
  requireParishPermission('parish.intentions.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/contenue2', await buildCommonLocals(req));
  }
);

refreshRouter.get(
  '/refresh_third',
  requireParishPermission('parish.masses.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/contenue3', await buildCommonLocals(req));
  }
);

refreshRouter.get(
  '/refresh_four',
  requireParishPermission('parish.announcements.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/contenue4', await buildCommonLocals(req));
  }
);

refreshRouter.get(
  '/parish/reports',
  requireParishPermission('parish.reports.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/parish_reports', await buildCommonLocals(req));
  }
);

refreshRouter.get(
  '/parish/users',
  requireParishPermission('parish.users.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/parish_users', await buildCommonLocals(req));
  }
);

refreshRouter.get(
  '/parish/roles',
  requireParishPermission('parish.roles.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/parish_roles', await buildCommonLocals(req));
  }
);

refreshRouter.get(
  '/parish/settings',
  requireParishPermission('parish.settings.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/parish_settings', await buildCommonLocals(req));
  }
);

refreshRouter.get(
  '/parish/audit',
  requireParishPermission('parish.audit.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/parish_audit', await buildCommonLocals(req));
  }
);

refreshRouter.get(
  '/parish/payments',
  requireParishPermission('parish.payments.view'),
  async (req: Request, res: Response) => {
    res.render('pagepart/parish_payments', await buildCommonLocals(req));
  }
);
