import type Database from 'better-sqlite3';
import type { User, UserWithPassword } from './auth.types.js';

export interface AuthRepository {
  /** Devuelve `undefined` si el email ya existe. */
  insert(email: string, passwordHash: string, name: string): User | undefined;
  findByEmail(email: string): UserWithPassword | undefined;
}

const COLUMNS = 'id, email, name, created_at AS createdAt';

export function createAuthRepository(db: Database.Database): AuthRepository {
  const insertStmt = db.prepare<[string, string, string], User>(
    `INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)
     ON CONFLICT (email) DO NOTHING
     RETURNING ${COLUMNS}`,
  );
  const findByEmailStmt = db.prepare<[string], UserWithPassword>(
    `SELECT ${COLUMNS}, password_hash AS passwordHash FROM users WHERE email = ?`,
  );

  return {
    insert: (email, passwordHash, name) => insertStmt.get(email, passwordHash, name),
    findByEmail: (email) => findByEmailStmt.get(email),
  };
}
