import { Router, Request, Response } from 'express';
import { getDashboardStats } from '../store/inMemoryDb.js';

export const refreshRouter = Router();

refreshRouter.get('/refresh_firt', (_req: Request, res: Response) => {
  const stats = getDashboardStats();
  res.render('pagepart/contenue1', { stats });
});

refreshRouter.get('/refresh_second', (_req: Request, res: Response) => {
  const stats = getDashboardStats();
  res.render('pagepart/contenue2', { stats });
});

refreshRouter.get('/refresh_third', (_req: Request, res: Response) => {
  const stats = getDashboardStats();
  res.render('pagepart/contenue3', { stats });
});

refreshRouter.get('/refresh_four', (_req: Request, res: Response) => {
  const stats = getDashboardStats();
  res.render('pagepart/contenue4', { stats });
});
