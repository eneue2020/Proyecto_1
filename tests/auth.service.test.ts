import type Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/connection.js';
import { createAuthRepository } from '../src/modules/auth/auth.repository.js';
import { createAuthService, type AuthService } from '../src/modules/auth/auth.service.js';
import type { TokenPayload } from '../src/modules/auth/auth.types.js';
import { HttpError } from '../src/shared/http-error.js';

const JWT_SECRET = 'secreto-de-test';
const VALID_USER = { email: 'ana@example.com', password: 'contraseña-segura', name: 'Ana' };

async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  const err = await promise.then(
    () => expect.unreachable('debería haber fallado'),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect(err).toMatchObject({ status, code });
}

function decode(token: string): TokenPayload & { iat: number; exp: number } {
  return jwt.verify(token, JWT_SECRET) as TokenPayload & { iat: number; exp: number };
}

describe('authService', () => {
  let db: Database.Database;
  let service: AuthService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    // saltRounds bajo solo para que los tests sean rápidos.
    service = createAuthService(createAuthRepository(db), { jwtSecret: JWT_SECRET, saltRounds: 4 });
  });

  afterEach(() => {
    db.close();
  });

  describe('register', () => {
    it('registra al usuario, hashea el password y devuelve un JWT de 24 h', async () => {
      const { token, user } = await service.register({
        ...VALID_USER,
        email: '  Ana@Example.COM ',
      });

      expect(user).toMatchObject({ email: 'ana@example.com', name: 'Ana' });
      expect(user).not.toHaveProperty('passwordHash');

      const payload = decode(token);
      expect(payload.sub).toBe(String(user.id));
      expect(payload.email).toBe('ana@example.com');
      expect(payload.exp - payload.iat).toBe(24 * 60 * 60);

      const row = db
        .prepare<[number], { email: string; password_hash: string }>(
          'SELECT email, password_hash FROM users WHERE id = ?',
        )
        .get(user.id);
      expect(row?.email).toBe('ana@example.com');
      expect(row?.password_hash).not.toBe(VALID_USER.password);
      expect(await bcrypt.compare(VALID_USER.password, row?.password_hash ?? '')).toBe(true);
    });

    it('falla con 409 si el email ya existe, aunque cambien las mayúsculas', async () => {
      await service.register(VALID_USER);

      await expectHttpError(service.register(VALID_USER), 409, 'EMAIL_ALREADY_EXISTS');
      await expectHttpError(
        service.register({ ...VALID_USER, email: 'ANA@EXAMPLE.COM' }),
        409,
        'EMAIL_ALREADY_EXISTS',
      );
      expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
    });

    it.each([
      ['email inválido', { email: 'no-es-email' }, 'INVALID_EMAIL'],
      ['password corto', { password: 'corto' }, 'PASSWORD_TOO_SHORT'],
      ['password de más de 72 bytes', { password: 'ñ'.repeat(37) }, 'PASSWORD_TOO_LONG'],
      ['nombre vacío', { name: '   ' }, 'INVALID_NAME'],
    ])('falla con 400 con %s', async (_caso, override, code) => {
      await expectHttpError(service.register({ ...VALID_USER, ...override }), 400, code);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await service.register(VALID_USER);
    });

    it('devuelve un JWT válido con credenciales correctas', async () => {
      const { token, user } = await service.login({
        email: VALID_USER.email,
        password: VALID_USER.password,
      });

      expect(user).toMatchObject({ email: 'ana@example.com', name: 'Ana' });
      expect(user).not.toHaveProperty('passwordHash');
      const payload = decode(token);
      expect(payload.sub).toBe(String(user.id));
      expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
    });

    it('falla con 401 si el password es incorrecto', async () => {
      await expectHttpError(
        service.login({ email: VALID_USER.email, password: 'otra-contraseña' }),
        401,
        'INVALID_CREDENTIALS',
      );
    });

    it('falla con 401 (mismo error) si el email no existe', async () => {
      await expectHttpError(
        service.login({ email: 'nadie@example.com', password: VALID_USER.password }),
        401,
        'INVALID_CREDENTIALS',
      );
    });

    it('funciona con el email en mayúsculas', async () => {
      const { user } = await service.login({
        email: 'ANA@EXAMPLE.COM',
        password: VALID_USER.password,
      });

      expect(user.email).toBe('ana@example.com');
    });
  });
});
