import type Database from 'better-sqlite3';
import type { DailyClicks, DashboardTotals, PeriodComparison, UrlStats } from './dashboard.types.js';

/** Límites del periodo como texto ISO: se comparan directamente con `clicked_at`. */
export interface PeriodRange {
  userId: number;
  previousFrom: string;
  from: string;
  to: string;
}

export interface DashboardRepository {
  /** Ejecuta las lecturas en una transacción para que todas vean el mismo estado. */
  read<T>(fn: () => T): T;
  totals(userId: number): DashboardTotals;
  urlStats(range: PeriodRange, limit: number): UrlStats[];
  dailyClicks(range: PeriodRange): DailyClicks[];
  periodComparison(range: PeriodRange): PeriodComparison;
}

export function createDashboardRepository(db: Database.Database): DashboardRepository {
  // Totales históricos desde los contadores de `urls`: no dependen del número de clicks.
  const totalsStmt = db.prepare<[number], DashboardTotals>(
    `SELECT COUNT(*) AS urls, COALESCE(SUM(click_count), 0) AS clicks, MAX(last_click_at) AS lastClickAt
     FROM urls WHERE user_id = ?`,
  );
  const urlStatsStmt = db.prepare<[PeriodRange & { limit: number }], UrlStats>(
    `SELECT u.code, u.original_url AS originalUrl, u.created_at AS createdAt,
            u.click_count AS totalClicks,
            (SELECT COUNT(*) FROM clicks c
             WHERE c.url_id = u.id AND c.clicked_at >= @from AND c.clicked_at < @to) AS periodClicks,
            u.last_click_at AS lastClickAt
     FROM urls u
     WHERE u.user_id = @userId
     ORDER BY periodClicks DESC, u.created_at DESC, u.id DESC
     LIMIT @limit`,
  );
  // Solo devuelve los días con clicks; el servicio rellena el resto con 0.
  const dailyClicksStmt = db.prepare<[PeriodRange], DailyClicks>(
    `SELECT substr(c.clicked_at, 1, 10) AS date, COUNT(*) AS clicks
     FROM clicks c JOIN urls u ON u.id = c.url_id
     WHERE u.user_id = @userId AND c.clicked_at >= @from AND c.clicked_at < @to
     GROUP BY date
     ORDER BY date`,
  );
  const periodComparisonStmt = db.prepare<[PeriodRange], PeriodComparison>(
    `SELECT COUNT(*) FILTER (WHERE c.clicked_at >= @from)                  AS current,
            COUNT(*) FILTER (WHERE c.clicked_at <  @from)                  AS previous,
            COUNT(DISTINCT c.ip_hash) FILTER (WHERE c.clicked_at >= @from) AS currentUniqueVisitors
     FROM clicks c JOIN urls u ON u.id = c.url_id
     WHERE u.user_id = @userId AND c.clicked_at >= @previousFrom AND c.clicked_at < @to`,
  );

  return {
    read: (fn) => db.transaction(fn)(),
    // Un agregado sin GROUP BY siempre devuelve exactamente una fila.
    totals: (userId) => totalsStmt.get(userId)!,
    urlStats: (range, limit) => urlStatsStmt.all({ ...range, limit }),
    dailyClicks: (range) => dailyClicksStmt.all(range),
    periodComparison: (range) => periodComparisonStmt.get(range)!,
  };
}
