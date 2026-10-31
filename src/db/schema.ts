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
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      code          TEXT    NOT NULL UNIQUE,
      original_url  TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      user_id       INTEGER REFERENCES users (id) ON DELETE CASCADE,
      click_count   INTEGER NOT NULL DEFAULT 0,
      last_click_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clicks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      url_id     INTEGER NOT NULL REFERENCES urls (id) ON DELETE CASCADE,
      clicked_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      referrer   TEXT,
      user_agent TEXT,
      ip_hash    TEXT
    );
  `);

  // Bases creadas antes de que existiera la autenticación: sus URLs quedan sin dueño (NULL).
  addColumnIfMissing(db, 'urls', 'user_id', 'INTEGER REFERENCES users (id) ON DELETE CASCADE');
  // Contadores desnormalizados: el dashboard lee los totales históricos sin recorrer `clicks`.
  // Antes de que existiera `clicks` no se registraban visitas, así que 0 / NULL es correcto.
  addColumnIfMissing(db, 'urls', 'click_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'urls', 'last_click_at', 'TEXT');

  db.exec('CREATE INDEX IF NOT EXISTS idx_urls_user_id ON urls (user_id)');
  // Cubriente para las consultas por periodo: rango por fecha y visitantes únicos sin leer la tabla.
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_clicks_url_time_ip ON clicks (url_id, clicked_at, ip_hash)',
  );
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
