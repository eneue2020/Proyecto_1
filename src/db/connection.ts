import Database from 'better-sqlite3';
import { initSchema } from './schema.js';

export function createDatabase(filename: string): Database.Database {
  const db = new Database(filename);

  db.pragma('journal_mode = WAL');
  // Con WAL, NORMAL no arriesga corrupción y evita un fsync por click (~10x más escrituras/s);
  // ante un corte de luz solo se perderían las últimas transacciones.
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);

  return db;
}
