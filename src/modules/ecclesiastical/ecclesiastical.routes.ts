import { Router, Request, Response } from 'express';
import {
  listDiocesesForProvince,
  listParishesForDiocese,
  listProvincesSummary,
  reviewParishRequest,
  submitMissingParishRequest,
  getParishRequests,
} from './ecclesiastical.service.js';
import { requireSuperAdmin } from '../auth/auth.middleware.js';
import type { ParishRequestStatus } from './ecclesiastical.types.js';

export const ecclesiasticalRouter = Router();

ecclesiasticalRouter.get('/provinces', (_req: Request, res: Response) => {
  res.json({
    provinces: listProvincesSummary(),
  });
});

ecclesiasticalRouter.get('/dioceses', (req: Request, res: Response) => {
  const provinceId = String(req.query.provinceId || '').trim();
  if (!provinceId) {
    res.status(400).json({
      error: 'Le paramètre provinceId est obligatoire.',
    });
    return;
  }

  const result = listDiocesesForProvince(provinceId);
  if (!result) {
    res.status(404).json({
      error: 'Province ecclésiastique introuvable.',
    });
    return;
  }

  res.json(result);
});

ecclesiasticalRouter.get('/parishes', (req: Request, res: Response) => {
  const dioceseId = String(req.query.dioceseId || '').trim();
  const searchQuery = String(req.query.q || '').trim();

  if (!dioceseId) {
    res.status(400).json({
      error: 'Le paramètre dioceseId est obligatoire.',
    });
    return;
  }

  const result = listParishesForDiocese(dioceseId, searchQuery);
  if (!result) {
    res.status(404).json({
      error: 'Diocèse introuvable.',
    });
    return;
  }

  res.json(result);
});

ecclesiasticalRouter.get(
  '/parish-requests',
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const rawStatus = String(req.query.status || '').trim().toUpperCase();
    const validStatuses: ParishRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
    const status = validStatuses.includes(rawStatus as ParishRequestStatus)
      ? (rawStatus as ParishRequestStatus)
      : undefined;

    const requests = await getParishRequests(status);
    res.json({ requests });
  }
);

ecclesiasticalRouter.post('/parish-requests', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const provinceId = typeof body.provinceId === 'string' ? body.provinceId : undefined;
  const dioceseId = typeof body.dioceseId === 'string' ? body.dioceseId : '';
  const parishName = typeof body.parishName === 'string' ? body.parishName : '';
  const userId =
    req.authContext?.user.id ??
    req.session.uid ??
    (typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : null);

  const result = await submitMissingParishRequest({
    provinceId,
    dioceseId,
    parishName,
    userId,
  });

  if (!result.ok) {
    res.status(result.statusCode).json({
      success: false,
      error: result.error,
    });
    return;
  }

  res.status(201).json({
    success: true,
    request: result.request,
  });
});

ecclesiasticalRouter.patch(
  '/parish-requests/:id',
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const requestId = String(req.params.id || '').trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = String(body.decision || '').trim().toUpperCase();
    const adminDecisionNote =
      typeof body.adminDecisionNote === 'string' ? body.adminDecisionNote : undefined;

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      res.status(400).json({
        success: false,
        error: 'Décision invalide. Valeurs attendues : APPROVED ou REJECTED.',
      });
      return;
    }

    const result = await reviewParishRequest({
      requestId,
      decision,
      adminDecisionNote,
    });

    if (!result.ok) {
      res.status(result.statusCode).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({
      success: true,
      request: result.request,
    });
  }
);
