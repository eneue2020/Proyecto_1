import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/connection.js';
import { initSchema } from '../src/db/schema.js';

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

describe('initSchema', () => {
  it('crea las tablas users, urls (con user_id y contadores) y clicks en una base vacía', () => {
    const db = new Database(':memory:');

    initSchema(db);

    expect(columnsOf(db, 'users')).toEqual(['id', 'email', 'password_hash', 'name', 'created_at']);
    expect(columnsOf(db, 'urls')).toEqual([
      'id',
      'code',
      'original_url',
      'created_at',
      'user_id',
      'click_count',
      'last_click_at',
    ]);
    expect(columnsOf(db, 'clicks')).toEqual([
      'id',
      'url_id',
      'clicked_at',
      'referrer',
      'user_agent',
      'ip_hash',
    ]);
    db.close();
  });

  it('crea el índice cubriente de clicks (url_id, clicked_at, ip_hash)', () => {
    const db = new Database(':memory:');

    initSchema(db);

    const indexed = (db.pragma('index_info(idx_clicks_url_time_ip)') as { name: string }[]).map(
      (c) => c.name,
    );
    expect(indexed).toEqual(['url_id', 'clicked_at', 'ip_hash']);
    db.close();
  });

  it('migra una tabla urls antigua: añade user_id y los contadores y conserva los datos', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE urls (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        code         TEXT    NOT NULL UNIQUE,
        original_url TEXT    NOT NULL,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO urls (code, original_url) VALUES ('Antigua', 'https://viejo.com/');
    `);

    initSchema(db);

    expect(columnsOf(db, 'urls')).toEqual(expect.arrayContaining(['user_id', 'click_count', 'last_click_at']));
    expect(db.prepare('SELECT code, user_id, click_count, last_click_at FROM urls').all()).toEqual([
      { code: 'Antigua', user_id: null, click_count: 0, last_click_at: null },
    ]);
    db.close();
  });

  it('es idempotente: ejecutarlo dos veces no falla ni duplica columnas', () => {
    const db = new Database(':memory:');

    initSchema(db);
    initSchema(db);

    expect(columnsOf(db, 'urls').filter((c) => c === 'user_id')).toHaveLength(1);
    expect(columnsOf(db, 'urls').filter((c) => c === 'click_count')).toHaveLength(1);
    db.close();
  });

  it('borrar una URL borra sus clicks (ON DELETE CASCADE)', () => {
    const db = createDatabase(':memory:');
    db.exec(`
      INSERT INTO urls (code, original_url) VALUES ('Borrame', 'https://x.com/');
      INSERT INTO clicks (url_id) VALUES (1), (1);
    `);

    db.prepare("DELETE FROM urls WHERE code = 'Borrame'").run();

    expect(db.prepare('SELECT COUNT(*) AS n FROM clicks').get()).toEqual({ n: 0 });
    db.close();
  });
});
