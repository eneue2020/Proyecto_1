import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { initSchema } from '../src/db/schema.js';

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

describe('initSchema', () => {
  it('crea las tablas users y urls (con user_id) en una base vacía', () => {
    const db = new Database(':memory:');

    initSchema(db);

    expect(columnsOf(db, 'users')).toEqual(['id', 'email', 'password_hash', 'name', 'created_at']);
    expect(columnsOf(db, 'urls')).toEqual(['id', 'code', 'original_url', 'created_at', 'user_id']);
    db.close();
  });

  it('migra una tabla urls antigua: añade user_id y conserva los datos', () => {
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

    expect(columnsOf(db, 'urls')).toContain('user_id');
    expect(db.prepare('SELECT code, user_id FROM urls').all()).toEqual([
      { code: 'Antigua', user_id: null },
    ]);
    db.close();
  });

  it('es idempotente: ejecutarlo dos veces no falla ni duplica columnas', () => {
    const db = new Database(':memory:');

    initSchema(db);
    initSchema(db);

    expect(columnsOf(db, 'urls').filter((c) => c === 'user_id')).toHaveLength(1);
    db.close();
  });
});
