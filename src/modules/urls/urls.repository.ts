import type Database from 'better-sqlite3';
import type { ShortUrl } from './urls.types.js';

export interface UrlsRepository {
  /** Devuelve `undefined` si el código ya existe. */
  insert(code: string, originalUrl: string, userId: number): ShortUrl | undefined;
  findByCode(code: string): ShortUrl | undefined;
  findAll(): ShortUrl[];
  /** Devuelve `true` si se borró alguna fila. */
  deleteByCode(code: string): boolean;
}

const COLUMNS = 'code, original_url AS originalUrl, created_at AS createdAt, user_id AS userId';

export function createUrlsRepository(db: Database.Database): UrlsRepository {
  const insertStmt = db.prepare<[string, string, number], ShortUrl>(
    `INSERT INTO urls (code, original_url, user_id) VALUES (?, ?, ?)
     ON CONFLICT (code) DO NOTHING
     RETURNING ${COLUMNS}`,
  );
  const findByCodeStmt = db.prepare<[string], ShortUrl>(
    `SELECT ${COLUMNS} FROM urls WHERE code = ?`,
  );
  const findAllStmt = db.prepare<[], ShortUrl>(`SELECT ${COLUMNS} FROM urls ORDER BY id DESC`);
  const deleteByCodeStmt = db.prepare<[string]>('DELETE FROM urls WHERE code = ?');

  return {
    insert: (code, originalUrl, userId) => insertStmt.get(code, originalUrl, userId),
    findByCode: (code) => findByCodeStmt.get(code),
    findAll: () => findAllStmt.all(),
    deleteByCode: (code) => deleteByCodeStmt.run(code).changes > 0,
  };
}
