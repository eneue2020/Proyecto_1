import express, { type Express } from 'express';
import type Database from 'better-sqlite3';
import { createAnalyticsRepository } from './modules/analytics/analytics.repository.js';
import { createAnalyticsService } from './modules/analytics/analytics.service.js';
import { createAuthMiddleware } from './modules/auth/auth.middleware.js';
import { createAuthRepository } from './modules/auth/auth.repository.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createDashboardRepository } from './modules/dashboard/dashboard.repository.js';
import { createDashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { createDashboardService } from './modules/dashboard/dashboard.service.js';
import { healthRouter } from './modules/health/health.routes.js';
import { createUrlsRepository } from './modules/urls/urls.repository.js';
import { createRedirectRouter, createUrlsRouter } from './modules/urls/urls.routes.js';
import { createUrlsService } from './modules/urls/urls.service.js';
import { errorHandler, notFoundHandler } from './shared/error-handler.js';

export interface AppDeps {
  db: Database.Database;
  jwtSecret: string;
  /** Coste de bcrypt; solo se baja en tests para que sean rápidos. */
  saltRounds?: number;
  /** Secreto del HMAC de las IPs de los clicks; si falta se usa `jwtSecret`. */
  clickHashSecret?: string;
  /** Reloj del dashboard; solo se fija en tests para que el periodo sea predecible. */
  now?: () => Date;
}

export function createApp({ db, jwtSecret, saltRounds, clickHashSecret, now }: AppDeps): Express {
  const app = express();
  const urlsService = createUrlsService(createUrlsRepository(db));
  const analyticsService = createAnalyticsService(createAnalyticsRepository(db), {
    hashSecret: clickHashSecret ?? jwtSecret,
  });
  const dashboardService = createDashboardService(createDashboardRepository(db), {
    ...(now !== undefined && { now }),
  });
  const authService = createAuthService(createAuthRepository(db), {
    jwtSecret,
    ...(saltRounds !== undefined && { saltRounds }),
  });
  const requireAuth = createAuthMiddleware(jwtSecret);

  app.use(express.json());
  app.use('/health', healthRouter);
  app.use('/auth', createAuthRouter(authService));
  app.use('/urls', createUrlsRouter(urlsService, requireAuth));
  app.use('/dashboard', createDashboardRouter(dashboardService, requireAuth));
  // Va al final: `/:code` capturaría cualquier ruta de un solo segmento.
  app.use('/', createRedirectRouter(urlsService, analyticsService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
