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

export const refreshRouter = Router();

refreshRouter.use(requireParishContext);

function buildCommonLocals(req: Request) {
  const ctx = req.authContext!;
  const stats = buildParishDashboardData(ctx.activeParish!.id);
  const members = ctx.permissions.includes('parish.users.view')
    ? listParishMembersDetailed(ctx.activeParish!.id)
    : [];
  const auditLogs = ctx.permissions.includes('parish.audit.view')
    ? listAuditLogs({ scope: 'PARISH', parishId: ctx.activeParish!.id, limit: 40 })
    : [];
  const notifications = listNotificationsForParish(ctx.activeParish!.id, ctx.user.id);

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
  };
}

refreshRouter.get('/refresh_firt', requireParishPermission('parish.dashboard.view'), (req: Request, res: Response) => {
  res.render('pagepart/contenue1', buildCommonLocals(req));
});

refreshRouter.get('/refresh_second', requireParishPermission('parish.intentions.view'), (req: Request, res: Response) => {
  res.render('pagepart/contenue2', buildCommonLocals(req));
});

refreshRouter.get('/refresh_third', requireParishPermission('parish.masses.view'), (req: Request, res: Response) => {
  res.render('pagepart/contenue3', buildCommonLocals(req));
});

refreshRouter.get('/refresh_four', requireParishPermission('parish.announcements.view'), (req: Request, res: Response) => {
  res.render('pagepart/contenue4', buildCommonLocals(req));
});

refreshRouter.get('/parish/reports', requireParishPermission('parish.reports.view'), (req: Request, res: Response) => {
  res.render('pagepart/parish_reports', buildCommonLocals(req));
});

refreshRouter.get('/parish/users', requireParishPermission('parish.users.view'), (req: Request, res: Response) => {
  res.render('pagepart/parish_users', buildCommonLocals(req));
});

refreshRouter.get('/parish/roles', requireParishPermission('parish.roles.view'), (req: Request, res: Response) => {
  res.render('pagepart/parish_roles', buildCommonLocals(req));
});

refreshRouter.get('/parish/settings', requireParishPermission('parish.settings.view'), (req: Request, res: Response) => {
  res.render('pagepart/parish_settings', buildCommonLocals(req));
});

refreshRouter.get('/parish/audit', requireParishPermission('parish.audit.view'), (req: Request, res: Response) => {
  res.render('pagepart/parish_audit', buildCommonLocals(req));
});
