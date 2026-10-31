import type Database from 'better-sqlite3';

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS urls (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      code         TEXT    NOT NULL UNIQUE,
      original_url TEXT    NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      user_id      INTEGER REFERENCES users (id) ON DELETE CASCADE
    );
  `);

  // Bases creadas antes de que existiera la autenticación: sus URLs quedan sin dueño (NULL).
  addColumnIfMissing(db, 'urls', 'user_id', 'INTEGER REFERENCES users (id) ON DELETE CASCADE');

  db.exec('CREATE INDEX IF NOT EXISTS idx_urls_user_id ON urls (user_id)');
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
