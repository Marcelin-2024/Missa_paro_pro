import type { NextFunction, Request, Response } from 'express';
import { getPlatformState } from '../platform/platform.repository.js';
import type {
  ParishEntity,
  PermissionCode,
  RoleCode,
  UserEntity,
} from '../platform/platform.types.js';
import { computeEffectiveAccess, getUserActiveMemberships } from '../roles/rbac.service.js';
import { generateCsrfToken } from './password.utils.js';

export interface ActiveRequestContext {
  user: UserEntity;
  activeParish: ParishEntity | null;
  activeRoles: RoleCode[];
  permissions: PermissionCode[];
  memberships: ReturnType<typeof getUserActiveMemberships>;
}

declare global {
  namespace Express {
    interface Request {
      authContext?: ActiveRequestContext;
    }
  }
}

const loginAttemptMap = new Map<string, { count: number; lockedUntilMs: number }>();

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSec?: number } {
  const rec = loginAttemptMap.get(key);
  if (!rec) return { allowed: true };
  if (rec.lockedUntilMs > Date.now()) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.lockedUntilMs - Date.now()) / 1000) };
  }
  return { allowed: true };
}

export function recordLoginFailure(key: string): void {
  const prev = loginAttemptMap.get(key) ?? { count: 0, lockedUntilMs: 0 };
  const nextCount = prev.lockedUntilMs > Date.now() ? prev.count + 1 : prev.count + 1;
  const lockedUntilMs = nextCount >= 5 ? Date.now() + 5 * 60 * 1000 : 0;
  loginAttemptMap.set(key, { count: nextCount, lockedUntilMs });
}

export function clearLoginFailures(key: string): void {
  loginAttemptMap.delete(key);
}

export function attachSessionContext(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.currentUser = null;
  res.locals.activeParish = null;
  res.locals.activeRoles = [];
  res.locals.permissions = [];

  const uid = req.session.uid;
  if (!uid) {
    next();
    return;
  }

  const state = getPlatformState();
  const user = state.users.find((u) => u.id === uid);

  if (!user || user.status === 'SUSPENDED' || user.status === 'DISABLED') {
    req.session.destroy(() => {
      next();
    });
    return;
  }

  const memberships = getUserActiveMemberships(user.id);
  let selectedParishId = req.session.activeParishId || user.preferredParishId || '';
  if (!memberships.some((m) => m.parish?.id === selectedParishId)) {
    selectedParishId = memberships[0]?.parish?.id || '';
  }

  let activeParish: ParishEntity | null = null;
  let activeRoles: RoleCode[] = [];
  let permissions: PermissionCode[] = [];

  if (selectedParishId) {
    const matched = memberships.find((m) => m.parish?.id === selectedParishId);
    if (matched?.parish) {
      activeParish = matched.parish;
      const access = computeEffectiveAccess(user.id, matched.parish.id);
      activeRoles = access?.activeRoles ?? [];
      permissions = access?.permissions ?? [];
      req.session.activeParishId = matched.parish.id;
    }
  }

  req.authContext = {
    user,
    activeParish,
    activeRoles,
    permissions,
    memberships,
  };

  res.locals.currentUser = user;
  res.locals.activeParish = activeParish;
  res.locals.activeRoles = activeRoles;
  res.locals.permissions = permissions;
  res.locals.memberships = memberships;

  next();
}

export function verifyCsrfForSessionMutation(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    next();
    return;
  }

  if (!req.session.uid) {
    next();
    return;
  }

  const headerToken = String(req.headers['x-csrf-token'] || '').trim();
  const bodyToken =
    req.body && typeof req.body === 'object' && typeof (req.body as Record<string, unknown>)._csrf === 'string'
      ? String((req.body as Record<string, unknown>)._csrf).trim()
      : '';

  if (req.session.csrfToken && (headerToken === req.session.csrfToken || bodyToken === req.session.csrfToken)) {
    next();
    return;
  }

  // Fallback check: verify Origin matches Host / X-Forwarded-Host or X-Requested-With on same-origin fetch
  const origin = String(req.headers.origin || '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        next();
        return;
      }
    } catch {
      // fall through
    }
  }

  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: 'Jeton CSRF invalide ou origine non autorisée.',
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.authContext;
  if (!ctx) {
    if (req.originalUrl.startsWith('/api/')) {
      res.status(401).json({ success: false, error: 'Authentification requise.' });
      return;
    }
    res.redirect('/');
    return;
  }

  if (ctx.user.mustChangePassword) {
    const allowedPaths = ['/page/changer-mot-de-passe', '/page/logout'];
    if (!allowedPaths.some((p) => req.originalUrl.startsWith(p))) {
      if (req.originalUrl.startsWith('/api/')) {
        res.status(403).json({
          success: false,
          code: 'PASSWORD_CHANGE_REQUIRED',
          error: 'Vous devez modifier votre mot de passe temporaire avant de continuer.',
        });
        return;
      }
      res.redirect('/page/changer-mot-de-passe');
      return;
    }
  }

  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const ctx = req.authContext;
    if (!ctx || !ctx.user.isSuperAdmin) {
      if (req.originalUrl.startsWith('/api/')) {
        res.status(403).json({
          success: false,
          error: 'Accès réservé au Super Administrateur Missa Paro.',
        });
        return;
      }
      res.status(403).redirect('/page/tableau_bords');
      return;
    }
    next();
  });
}

export function requireParishContext(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const ctx = req.authContext;
    if (!ctx || !ctx.activeParish || ctx.permissions.length === 0) {
      if (req.originalUrl.startsWith('/api/')) {
        res.status(403).json({
          success: false,
          error: 'Aucune appartenance paroissiale active pour cet espace.',
        });
        return;
      }
      if (ctx?.user.isSuperAdmin) {
        res.redirect('/super-admin');
        return;
      }
      res.status(403).render('compte', {
        champs: [],
        error: 'Votre compte ne dispose d’aucun espace paroissial actif.',
      });
      return;
    }
    next();
  });
}

export function requireParishPermission(permission: PermissionCode) {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireParishContext(req, res, () => {
      const ctx = req.authContext!;
      if (!ctx.permissions.includes(permission)) {
        if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/refresh/')) {
          res.status(403).json({
            success: false,
            error: `Permission insuffisante (${permission}).`,
          });
          return;
        }
        res.status(403).redirect('/page/tableau_bords');
        return;
      }
      next();
    });
  };
}
