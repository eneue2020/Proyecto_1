import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import type { AuthResult, TokenPayload } from '../src/modules/auth/auth.types.js';

const JWT_SECRET = 'secreto-de-test';
const VALID_USER = { email: 'ana@example.com', password: 'contraseña-segura', name: 'Ana' };

interface ErrorResponse {
  error: { code: string; message: string };
}

describe('módulo auth (HTTP)', () => {
  let db: Database.Database;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    db = createDatabase(':memory:');
    server = createApp({ db, jwtSecret: JWT_SECRET, saltRounds: 4 }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    db.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM users');
  });

  function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function expectValidToken(result: AuthResult) {
    const payload = jwt.verify(result.token, JWT_SECRET) as TokenPayload & {
      iat: number;
      exp: number;
    };
    expect(payload.sub).toBe(String(result.user.id));
    expect(payload.email).toBe(result.user.email);
    expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
  }

  describe('POST /auth/register', () => {
    it('responde 201 con el usuario y un token válido', async () => {
      const res = await post('/auth/register', { ...VALID_USER, email: 'Ana@Example.com' });
      const body = (await res.json()) as AuthResult;

      expect(res.status).toBe(201);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      expect(body.user).toEqual({
        id: expect.any(Number),
        email: 'ana@example.com',
        name: 'Ana',
        createdAt: expect.any(String),
      });
      expect(body.user).not.toHaveProperty('passwordHash');
      expectValidToken(body);
    });

    it('responde 409 EMAIL_ALREADY_EXISTS si el email ya está registrado', async () => {
      await post('/auth/register', VALID_USER);

      const res = await post('/auth/register', { ...VALID_USER, email: 'ANA@example.com' });
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(409);
      expect(body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it.each([
      ['email inválido', { email: 'ana-sin-arroba' }, 'INVALID_EMAIL'],
      ['password muy corto', { password: '1234567' }, 'PASSWORD_TOO_SHORT'],
      ['password demasiado largo', { password: 'x'.repeat(73) }, 'PASSWORD_TOO_LONG'],
      ['nombre vacío', { name: '  ' }, 'INVALID_NAME'],
      ['falta el email', { email: undefined }, 'INVALID_INPUT'],
      ['falta el password', { password: undefined }, 'INVALID_INPUT'],
      ['falta el nombre', { name: undefined }, 'INVALID_INPUT'],
      ['email que no es texto', { email: 42 }, 'INVALID_INPUT'],
    ])('responde 400 con %s', async (_caso, override, code) => {
      const res = await post('/auth/register', { ...VALID_USER, ...override });
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(400);
      expect(body.error.code).toBe(code);
      expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    });

    it('responde 400 INVALID_JSON si el body no es JSON válido', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ email: ',
      });
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('INVALID_JSON');
    });

    it('responde 400 INVALID_INPUT si no se envía body', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, { method: 'POST' });
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await post('/auth/register', VALID_USER);
    });

    it('responde 200 con el usuario y un token válido', async () => {
      const res = await post('/auth/login', {
        email: VALID_USER.email,
        password: VALID_USER.password,
      });
      const body = (await res.json()) as AuthResult;

      expect(res.status).toBe(200);
      expect(body.user).toMatchObject({ email: 'ana@example.com', name: 'Ana' });
      expect(body.user).not.toHaveProperty('passwordHash');
      expectValidToken(body);
    });

    it('acepta el email en mayúsculas', async () => {
      const res = await post('/auth/login', {
        email: 'ANA@EXAMPLE.COM',
        password: VALID_USER.password,
      });

      expect(res.status).toBe(200);
    });

    it.each([
      ['password incorrecto', { email: VALID_USER.email, password: 'otra-contraseña' }],
      ['email inexistente', { email: 'nadie@example.com', password: VALID_USER.password }],
    ])('responde 401 INVALID_CREDENTIALS con %s', async (_caso, credentials) => {
      const res = await post('/auth/login', credentials);
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(401);
      expect(body).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email o password incorrectos' },
      });
    });

    it.each([
      ['falta el email', { password: VALID_USER.password }],
      ['falta el password', { email: VALID_USER.email }],
      ['password que no es texto', { email: VALID_USER.email, password: 12345678 }],
    ])('responde 400 INVALID_INPUT si %s', async (_caso, credentials) => {
      const res = await post('/auth/login', credentials);
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  it('responde 404 en GET /auth/login (solo existe POST)', async () => {
    const res = await fetch(`${baseUrl}/auth/login`);

    expect(res.status).toBe(404);
  });
});
