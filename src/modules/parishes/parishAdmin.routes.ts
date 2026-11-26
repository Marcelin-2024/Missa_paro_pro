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
  getParishMemberDetails,
  listParishMembersDetailed,
  updateMembershipStatus,
  updateParishMemberByParishAdmin,
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
  deleteMesseForParish,
  getMesseDetailsForParish,
  listMassesForParish,
  updateMesseForParish,
  updateMesseStatus,
} from '../masses/masses.service.js';
import {
  approveAnnouncementForParish,
  archiveAnnouncementForParish,
  createAnnouncementForParish,
  deleteAnnouncementForParish,
  getAnnouncementDetailsForParish,
  listAnnouncementsForParish,
  updateAnnouncementForParish,
} from '../announcements/announcements.service.js';
import type { AnnonceEntity, MesseEntity, RoleCode } from '../platform/platform.types.js';

export const parishApiRouter = Router();

parishApiRouter.use(requireParishContext);
parishApiRouter.use(verifyCsrfForSessionMutation);

parishApiRouter.get(
  '/members',
  requireParishPermission('parish.users.view'),
  async (req: Request, res: Response) => {
    const parishId = req.authContext!.activeParish!.id;
    const members = await listParishMembersDetailed(parishId);
    res.json({
      parishId,
      members,
    });
  }
);

parishApiRouter.post(
  '/members',
  requireParishPermission('parish.users.manage'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const roles = Array.isArray(body.roles)
      ? body.roles.map((r) => String(r) as RoleCode)
      : typeof body.roles === 'string'
        ? [body.roles as RoleCode]
        : [];

    const result = await createOrAttachParishMember({
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
  }
);

parishApiRouter.post(
  '/memberships/:membershipId/roles',
  requireParishPermission('parish.roles.manage'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await assignRoleToMembership({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      membershipId: String(req.params.membershipId || ''),
      roleCode: String(body.roleCode || ''),
      expiresAt:
        typeof body.expiresAt === 'string' && body.expiresAt.trim() ? body.expiresAt.trim() : null,
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
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const result = await revokeRoleFromMembership({
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

parishApiRouter.get('/memberships/:membershipId', async (req: Request, res: Response) => {
  const ctx = req.authContext!;
  const canView =
    ctx.permissions.includes('parish.users.view') || ctx.permissions.includes('parish.roles.view');
  if (!canView) {
    res.status(403).json({
      success: false,
      error: 'Permission insuffisante pour consulter les détails de ce membre.',
    });
    return;
  }
  const detail = await getParishMemberDetails(
    ctx.activeParish!.id,
    String(req.params.membershipId || '')
  );
  if (!detail) {
    res.status(404).json({ success: false, error: 'Membre introuvable.' });
    return;
  }
  res.json({ success: true, member: detail });
});

parishApiRouter.patch(
  '/memberships/:membershipId',
  requireParishPermission('parish.users.manage'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await updateParishMemberByParishAdmin({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      membershipId: String(req.params.membershipId || ''),
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      phone: typeof body.phone === 'string' ? body.phone : undefined,
      titleLabel: typeof body.titleLabel === 'string' ? body.titleLabel : undefined,
    });
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, member: result.member });
  }
);

parishApiRouter.patch(
  '/memberships/:membershipId/status',
  requireParishPermission('parish.users.manage'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const status = String((req.body as Record<string, unknown>)?.status || '').toUpperCase() as
      | 'ACTIVE'
      | 'SUSPENDED'
      | 'REMOVED';
    if (!['ACTIVE', 'SUSPENDED', 'REMOVED'].includes(status)) {
      res.status(400).json({ success: false, error: 'Statut d’appartenance invalide.' });
      return;
    }

    const result = await updateMembershipStatus({
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
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const parishId = ctx.activeParish!.id;
    const targetUserId = String(req.params.userId || '');
    const members = await listParishMembersDetailed(parishId);
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
    const result = await updateUserStatus({
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
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const chapels = Array.isArray(body.chapels)
      ? body.chapels.map(String)
      : typeof body.chapels === 'string'
        ? body.chapels.split(',').map((s) => s.trim())
        : [];

    const result = await updateParishPracticalInfo({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      location: typeof body.location === 'string' ? body.location : undefined,
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

parishApiRouter.get(
  '/masses',
  requireParishPermission('parish.masses.view'),
  async (req: Request, res: Response) => {
    const masses = await listMassesForParish(req.authContext!.activeParish!.id);
    res.json({ masses });
  }
);

parishApiRouter.get(
  '/masses/:id',
  requireParishPermission('parish.masses.view'),
  async (req: Request, res: Response) => {
    const detail = await getMesseDetailsForParish(
      req.authContext!.activeParish!.id,
      String(req.params.id || '')
    );
    if (!detail) {
      res.status(404).json({ success: false, error: 'Messe introuvable.' });
      return;
    }
    res.json({ success: true, ...detail });
  }
);

parishApiRouter.post(
  '/masses',
  requireParishPermission('parish.masses.manage'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, string>;
    const result = await createMesseForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      date: body.date || '',
      horaire: body.horaire || '',
      celebrant: body.celebrant || '',
      type: body.type,
      lieu: body.lieu,
    });
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    res.status(201).json({ success: true, messe: result.messe });
  }
);

parishApiRouter.patch(
  '/masses/:id',
  requireParishPermission('parish.masses.manage'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, string>;
    const result = await updateMesseForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      messeId: String(req.params.id || ''),
      date: body.date || '',
      horaire: body.horaire || '',
      celebrant: body.celebrant || '',
      type: body.type,
      lieu: body.lieu,
      statut: body.statut as MesseEntity['statut'] | undefined,
    });
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, messe: result.messe });
  }
);

parishApiRouter.patch(
  '/masses/:id/status',
  requireParishPermission('parish.masses.manage'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const statut = String((req.body as Record<string, string>)?.statut || '') as
      | 'A venir'
      | 'Passée'
      | 'Annulée';
    if (!['A venir', 'Passée', 'Annulée'].includes(statut)) {
      res.status(400).json({ success: false, error: 'Statut de messe invalide.' });
      return;
    }
    const result = await updateMesseStatus({
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
  }
);

parishApiRouter.delete(
  '/masses/:id',
  requireParishPermission('parish.masses.manage'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const result = await deleteMesseForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      messeId: String(req.params.id || ''),
    });
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true });
  }
);

parishApiRouter.get(
  '/announcements',
  requireParishPermission('parish.announcements.view'),
  async (req: Request, res: Response) => {
    const annonces = await listAnnouncementsForParish(req.authContext!.activeParish!.id);
    res.json({ annonces });
  }
);

parishApiRouter.get(
  '/announcements/:id',
  requireParishPermission('parish.announcements.view'),
  async (req: Request, res: Response) => {
    const detail = await getAnnouncementDetailsForParish(
      req.authContext!.activeParish!.id,
      String(req.params.id || '')
    );
    if (!detail) {
      res.status(404).json({ success: false, error: 'Annonce introuvable.' });
      return;
    }
    res.json({ success: true, ...detail });
  }
);

parishApiRouter.post(
  '/announcements',
  requireParishPermission('parish.announcements.publish'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, string>;
    const result = await createAnnouncementForParish({
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
  }
);

parishApiRouter.patch(
  '/announcements/:id',
  requireParishPermission('parish.announcements.publish'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const body = (req.body ?? {}) as Record<string, string>;
    const result = await updateAnnouncementForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      annonceId: String(req.params.id || ''),
      type: body.type || 'Communique',
      titre: body.titre || '',
      dateAnnonce: body.dateAnnonce || '',
      contenu: body.contenu || '',
      statut: body.statut as AnnonceEntity['statut'] | undefined,
      canApproveDirectly: ctx.permissions.includes('parish.announcements.approve'),
    });
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, annonce: result.annonce });
  }
);

parishApiRouter.patch(
  '/announcements/:id/approve',
  requireParishPermission('parish.announcements.approve'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const result = await approveAnnouncementForParish({
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

parishApiRouter.patch(
  '/announcements/:id/archive',
  requireParishPermission('parish.announcements.publish'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const result = await archiveAnnouncementForParish({
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

parishApiRouter.delete(
  '/announcements/:id',
  requireParishPermission('parish.announcements.publish'),
  async (req: Request, res: Response) => {
    const ctx = req.authContext!;
    const result = await deleteAnnouncementForParish({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      parishId: ctx.activeParish!.id,
      annonceId: String(req.params.id || ''),
    });
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true });
  }
);

parishApiRouter.get(
  '/audit',
  requireParishPermission('parish.audit.view'),
  async (req: Request, res: Response) => {
    const logs = await listAuditLogs({
      scope: 'PARISH',
      parishId: req.authContext!.activeParish!.id,
      limit: 80,
    });
    res.json({ logs });
  }
);

parishApiRouter.get('/notifications', async (req: Request, res: Response) => {
  const ctx = req.authContext!;
  const notifications = await listNotificationsForParish(ctx.activeParish!.id, ctx.user.id);
  res.json({ notifications });
});

parishApiRouter.patch('/notifications/:id/read', async (req: Request, res: Response) => {
  await markNotificationRead(String(req.params.id || ''));
  res.json({ success: true });
});
