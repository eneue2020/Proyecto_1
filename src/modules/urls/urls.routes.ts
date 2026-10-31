import { Router, type Request, type RequestHandler } from 'express';
import type { AnalyticsService } from '../analytics/analytics.service.js';
import { getAuthUser } from '../auth/auth.middleware.js';
import { HttpError } from '../../shared/http-error.js';
import { CODE_PATTERN, type UrlsService } from './urls.service.js';
import type { ShortUrl } from './urls.types.js';

export function buildShortUrl(req: Request, code: string): string {
  return `${req.protocol}://${req.get('host')}/${code}`;
}

function toResponse(req: Request, url: ShortUrl) {
  return { ...url, shortUrl: buildShortUrl(req, url.code) };
}

export function createUrlsRouter(service: UrlsService, requireAuth: RequestHandler): Router {
  const router = Router();

  router.post('/', requireAuth, (req, res) => {
    const url: unknown = req.body?.url;
    if (typeof url !== 'string') {
      throw new HttpError(400, 'El campo "url" es obligatorio y debe ser un texto', 'INVALID_URL');
    }

    res.status(201).json(toResponse(req, service.shorten(url, getAuthUser(req).id)));
  });

  router.get('/', (req, res) => {
    res.status(200).json(service.list().map((url) => toResponse(req, url)));
  });

  router.delete('/:code', requireAuth, (req: Request<{ code: string }>, res) => {
    service.remove(req.params.code, getAuthUser(req).id);
    res.status(204).end();
  });

  return router;
}

export function createRedirectRouter(service: UrlsService, analytics: AnalyticsService): Router {
  const router = Router();

  // 302 y no 301: el navegador no la cachea, así cada visita pasa por el servidor.
  router.get('/:code', (req, res, next) => {
    // Lo que no tiene forma de código (p. ej. /favicon.ico) sigue hacia el 404 genérico.
    if (!CODE_PATTERN.test(req.params.code)) {
      next();
      return;
    }
    const target = service.resolve(req.params.code);
    // HEAD lo usan comprobadores de enlaces y previsualizaciones: no es una visita.
    if (req.method === 'GET') {
      analytics.recordClick(req.params.code, {
        ip: req.ip,
        referrer: req.get('referer'),
        userAgent: req.get('user-agent'),
      });
    }
    res.redirect(302, target);
  });

  return router;
}
