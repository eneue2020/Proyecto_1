import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/connection.js';
import { createAuthMiddleware } from '../src/modules/auth/auth.middleware.js';
import { createAuthRepository } from '../src/modules/auth/auth.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { errorHandler } from '../src/shared/error-handler.js';

const JWT_SECRET = 'secreto-de-test';

interface ErrorResponse {
  error: { code: string; message: string };
}

describe('middleware de autenticación', () => {
  let server: Server;
  let baseUrl: string;
  let handlerCalls: number;

  beforeAll(async () => {
    const app = express();
    app.get('/protegida', createAuthMiddleware(JWT_SECRET), (req, res) => {
      handlerCalls++;
      res.json({ user: req.user });
    });
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(() => {
    handlerCalls = 0;
  });

  function get(authorization?: string): Promise<Response> {
    return fetch(`${baseUrl}/protegida`, {
      headers: authorization === undefined ? {} : { authorization },
    });
  }

  async function expect401(res: Response, code: string) {
    const body = (await res.json()) as ErrorResponse;
    expect(res.status).toBe(401);
    expect(body.error.code).toBe(code);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(handlerCalls).toBe(0);
  }

  describe('token válido', () => {
    it('deja pasar y adjunta el usuario a req.user', async () => {
      const token = jwt.sign({ sub: '7', email: 'ana@example.com' }, JWT_SECRET, {
        expiresIn: '24h',
      });

      const res = await get(`Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: { id: 7, email: 'ana@example.com' } });
      expect(res.headers.get('www-authenticate')).toBeNull();
      expect(handlerCalls).toBe(1);
    });

    it('acepta el token que emite authService.register', async () => {
      const db = createDatabase(':memory:');
      const service = createAuthService(createAuthRepository(db), {
        jwtSecret: JWT_SECRET,
        saltRounds: 4,
      });
      const { token, user } = await service.register({
        email: 'ana@example.com',
        password: 'contraseña-segura',
        name: 'Ana',
      });
      db.close();

      const res = await get(`Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: { id: user.id, email: 'ana@example.com' } });
    });

    it('no distingue mayúsculas en el esquema "Bearer"', async () => {
      const token = jwt.sign({ sub: '1', email: 'a@b.com' }, JWT_SECRET);

      const res = await get(`bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  describe('sin token', () => {
    it.each([
      ['sin header Authorization', undefined],
      ['header vacío', ''],
      ['"Bearer" sin token', 'Bearer '],
      ['otro esquema (Basic)', 'Basic YW5hOnNlY3JldG8='],
      ['token sin esquema', 'eyJhbGciOiJIUzI1NiJ9.e30.x'],
    ])('responde 401 MISSING_TOKEN con %s', async (_caso, authorization) => {
      await expect401(await get(authorization), 'MISSING_TOKEN');
    });
  });

  describe('token expirado o malformado', () => {
    it('responde 401 TOKEN_EXPIRED si el token ha expirado', async () => {
      const haceDosDias = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
      const token = jwt.sign({ sub: '1', email: 'a@b.com', iat: haceDosDias }, JWT_SECRET, {
        expiresIn: '24h',
      });

      await expect401(await get(`Bearer ${token}`), 'TOKEN_EXPIRED');
    });

    it.each([
      ['texto que no es un JWT', () => 'no-soy-un-jwt'],
      ['JWT con firma alterada', () => `${jwt.sign({ sub: '1', email: 'a@b.com' }, JWT_SECRET)}x`],
      ['JWT firmado con otro secreto', () => jwt.sign({ sub: '1', email: 'a@b.com' }, 'otro')],
      [
        'JWT con alg "none"',
        () => jwt.sign({ sub: '1', email: 'a@b.com' }, '', { algorithm: 'none' }),
      ],
      ['JWT sin "sub"', () => jwt.sign({ email: 'a@b.com' }, JWT_SECRET)],
      ['JWT con "sub" no numérico', () => jwt.sign({ sub: 'abc', email: 'a@b.com' }, JWT_SECRET)],
      ['JWT sin "email"', () => jwt.sign({ sub: '1' }, JWT_SECRET)],
      ['JWT con payload de texto', () => jwt.sign('solo-texto', JWT_SECRET)],
    ])('responde 401 INVALID_TOKEN con %s', async (_caso, makeToken) => {
      await expect401(await get(`Bearer ${makeToken()}`), 'INVALID_TOKEN');
    });
  });
});
