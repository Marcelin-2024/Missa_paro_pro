import { Router, Request, Response } from 'express';
import {
  requireParishContext,
  requireParishPermission,
  verifyCsrfForSessionMutation,
} from '../auth/auth.middleware.js';
import {
  assignRoleToMembership,
  revokeRoleFromMembership,
} from '../roles/rbac.service.js';
import {
  createOrAttachParishMember,
  listParishMembersDetailed,
  updateMembershipStatus,
  updateUserStatus,
} from '../users/users.service.js';
import { updateParishPracticalInfo } from './parishes.service.js';
import { listAuditLogs } from '../audit/audit.service.js';
import {
  listNotificationsForParish,
  markNotificationRead,
} from '../notifications/notifications.service.js';
import {
  createMesseForParish,
  listMassesForParish,
  updateMesseStatus,
} from '../masses/masses.service.js';
import {
  approveAnnouncementForParish,
  createAnnouncementForParish,
  listAnnouncementsForParish,
} from '../announcements/announcements.service.js';
import type { AnnonceEntity, RoleCode } from '../platform/platform.types.js';

export const parishApiRouter = Router();

parishApiRouter.use(requireParishContext);
parishApiRouter.use(verifyCsrfForSessionMutation);

parishApiRouter.get('/members', requireParishPermission('parish.users.view'), (req: Request, res: Response) => {
  const parishId = req.authContext!.activeParish!.id;
  res.json({
    parishId,
    members: listParishMembersDetailed(parishId),
  });
});

parishApiRouter.post('/members', requireParishPermission('parish.users.manage'), (req: Request, res: Response) => {
  const ctx = req.authContext!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const roles = Array.isArray(body.roles)
    ? body.roles.map((r) => String(r) as RoleCode)
    : typeof body.roles === 'string'
      ? [body.roles as RoleCode]
      : [];

  const result = createOrAttachParishMember({
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    parishId: ctx.activeParish!.id,
    displayName: String(body.displayName || ''),
    email: String(body.email || ''),
    phone: String(body.phone || ''),
    roles,
    titleLabel: typeof body.titleLabel === 'string' ? body.titleLabel : undefined,
  });

  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }

  res.status(201).json({
    success: true,
    user: result.user,
    membership: result.membership,
    temporaryPassword: result.temporaryPassword,
  });
});

parishApiRouter.post(
  '/memberships/:membershipId/roles',
  requireParishPermission('parish.roles.manage'),
  (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = assignRoleToMembership({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      membershipId: String(req.params.membershipId || ''),
      roleCode: String(body.roleCode || ''),
      expiresAt: typeof body.expiresAt === 'string' && body.expiresAt.trim() ? body.expiresAt.trim() : null,
    });

    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }

    res.status(201).json({ success: true, assignment: result.assignment });
  }
);

parishApiRouter.delete(
  '/memberships/:membershipId/roles/:roleCode',
  requireParishPermission('parish.roles.manage'),
  (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const result = revokeRoleFromMembership({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      membershipId: String(req.params.membershipId || ''),
      roleCode: String(req.params.roleCode || ''),
    });

    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true });
  }
);

parishApiRouter.patch(
  '/memberships/:membershipId/status',
  requireParishPermission('parish.users.manage'),
  (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const status = String((req.body as Record<string, unknown>)?.status || '').toUpperCase() as
      | 'ACTIVE'
      | 'SUSPENDED'
      | 'REMOVED';
    if (!['ACTIVE', 'SUSPENDED', 'REMOVED'].includes(status)) {
      res.status(400).json({ success: false, error: 'Statut d’appartenance invalide.' });
      return;
    }

    const result = updateMembershipStatus({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      membershipId: String(req.params.membershipId || ''),
      status,
    });

    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true });
  }
);

parishApiRouter.patch(
  '/users/:userId/status',
  requireParishPermission('parish.users.manage'),
  (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const parishId = ctx.activeParish!.id;
    const targetUserId = String(req.params.userId || '');
    const members = listParishMembersDetailed(parishId);
    if (!members.some((m) => m.user.id === targetUserId)) {
      res.status(403).json({
        success: false,
        error: 'Cet utilisateur n’appartient pas à votre paroisse.',
      });
      return;
    }

    const status = String((req.body as Record<string, unknown>)?.status || '').toUpperCase() as
      | 'ACTIVE'
      | 'SUSPENDED'
      | 'DISABLED';
    const result = updateUserStatus({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      userId: targetUserId,
      status,
      scope: 'PARISH',
      parishId,
    });

    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, user: result.user });
  }
);

parishApiRouter.post(
  '/settings',
  requireParishPermission('parish.settings.manage'),
  (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const chapels = Array.isArray(body.chapels)
      ? body.chapels.map(String)
      : typeof body.chapels === 'string'
        ? body.chapels.split(',').map((s) => s.trim())
        : [];

    const result = updateParishPracticalInfo({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      phone: String(body.phone || ''),
      email: String(body.email || ''),
      address: String(body.address || ''),
      massScheduleSummary: String(body.massScheduleSummary || ''),
      chapelsEnabled: Boolean(body.chapelsEnabled),
      chapels,
    });

    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, parish: result.parish });
  }
);

parishApiRouter.get('/masses', requireParishPermission('parish.masses.view'), (req: Request, res: Response) => {
  res.json({ masses: listMassesForParish(req.authContext!.activeParish!.id) });
});

parishApiRouter.post('/masses', requireParishPermission('parish.masses.manage'), (req: Request, res: Response) => {
  const ctx = req.authContext!;
  const body = (req.body ?? {}) as Record<string, string>;
  const result = createMesseForParish({
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    parishId: ctx.activeParish!.id,
    date: body.date || '',
    horaire: body.horaire || '',
    celebrant: body.celebrant || '',
    type: body.type,
  });
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.status(201).json({ success: true, messe: result.messe });
});

parishApiRouter.patch('/masses/:id/status', requireParishPermission('parish.masses.manage'), (req: Request, res: Response) => {
  const ctx = req.authContext!;
  const statut = String((req.body as Record<string, string>)?.statut || '') as 'A venir' | 'Passée' | 'Annulée';
  if (!['A venir', 'Passée', 'Annulée'].includes(statut)) {
    res.status(400).json({ success: false, error: 'Statut de messe invalide.' });
    return;
  }
  const result = updateMesseStatus({
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    parishId: ctx.activeParish!.id,
    messeId: String(req.params.id || ''),
    statut,
  });
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, messe: result.messe });
});

parishApiRouter.get('/announcements', requireParishPermission('parish.announcements.view'), (req: Request, res: Response) => {
  res.json({ annonces: listAnnouncementsForParish(req.authContext!.activeParish!.id) });
});

parishApiRouter.post('/announcements', requireParishPermission('parish.announcements.publish'), (req: Request, res: Response) => {
  const ctx = req.authContext!;
  const body = (req.body ?? {}) as Record<string, string>;
  const result = createAnnouncementForParish({
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    parishId: ctx.activeParish!.id,
    type: (body.type as AnnonceEntity['type']) || 'Communique',
    titre: body.titre || '',
    dateAnnonce: body.dateAnnonce || '',
    contenu: body.contenu || '',
    canApproveDirectly: ctx.permissions.includes('parish.announcements.approve'),
  });
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.status(201).json({ success: true, annonce: result.annonce });
});

parishApiRouter.patch(
  '/announcements/:id/approve',
  requireParishPermission('parish.announcements.approve'),
  (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const result = approveAnnouncementForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      annonceId: String(req.params.id || ''),
    });
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, annonce: result.annonce });
  }
);

parishApiRouter.get('/audit', requireParishPermission('parish.audit.view'), (req: Request, res: Response) => {
  res.json({
    logs: listAuditLogs({
      scope: 'PARISH',
      parishId: req.authContext!.activeParish!.id,
      limit: 80,
    }),
  });
});

parishApiRouter.get('/notifications', (req: Request, res: Response) => {
  const ctx = req.authContext!;
  res.json({
    notifications: listNotificationsForParish(ctx.activeParish!.id, ctx.user.id),
  });
});

parishApiRouter.patch('/notifications/:id/read', (req: Request, res: Response) => {
  markNotificationRead(String(req.params.id || ''));
  res.json({ success: true });
});
