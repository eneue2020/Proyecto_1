import type Database from 'better-sqlite3';

export interface AnalyticsRepository {
  /** Devuelve `false` si el código no existe. */
  recordClick(
    code: string,
    referrer: string | null,
    userAgent: string | null,
    ipHash: string | null,
  ): boolean;
}

export function createAnalyticsRepository(db: Database.Database): AnalyticsRepository {
  const insertStmt = db.prepare<
    [string | null, string | null, string | null, string],
    { urlId: number; clickedAt: string }
  >(
    `INSERT INTO clicks (url_id, referrer, user_agent, ip_hash)
     SELECT id, ?, ?, ? FROM urls WHERE code = ?
     RETURNING url_id AS urlId, clicked_at AS clickedAt`,
  );
  const bumpCounterStmt = db.prepare<[string, number]>(
    'UPDATE urls SET click_count = click_count + 1, last_click_at = ? WHERE id = ?',
  );

  // En la misma transacción: el contador nunca se desvía del número real de clicks.
  const recordClick = db.transaction(
    (code: string, referrer: string | null, userAgent: string | null, ipHash: string | null) => {
      const click = insertStmt.get(referrer, userAgent, ipHash, code);
      if (!click) {
        return false;
      }
      bumpCounterStmt.run(click.clickedAt, click.urlId);
      return true;
    },
  );

  return { recordClick };
}
