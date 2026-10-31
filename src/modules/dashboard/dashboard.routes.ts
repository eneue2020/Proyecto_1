import { Router, type RequestHandler } from 'express';
import { getAuthUser } from '../auth/auth.middleware.js';
import { buildShortUrl } from '../urls/urls.routes.js';
import type { DashboardService } from './dashboard.service.js';

export function createDashboardRouter(service: DashboardService, requireAuth: RequestHandler): Router {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    // Lo no numérico (o un parámetro repetido, que llega como array) da NaN y el servicio lo rechaza.
    const days = req.query['days'] === undefined ? undefined : Number(req.query['days']);
    const dashboard = service.get(getAuthUser(req).id, days);

    res.status(200).json({
      ...dashboard,
      urls: dashboard.urls.map((url) => ({ ...url, shortUrl: buildShortUrl(req, url.code) })),
    });
  });

  return router;
}
