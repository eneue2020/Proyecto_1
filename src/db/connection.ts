import Database from 'better-sqlite3';
import { initSchema } from './schema.js';

export function createDatabase(filename: string): Database.Database {
  const db = new Database(filename);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);

  return db;
}
