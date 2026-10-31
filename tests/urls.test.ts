import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import type { AuthResult } from '../src/modules/auth/auth.types.js';
import { createUrlsRepository } from '../src/modules/urls/urls.repository.js';
import { CODE_PATTERN, createUrlsService } from '../src/modules/urls/urls.service.js';
import type { ShortUrl } from '../src/modules/urls/urls.types.js';
import { HttpError } from '../src/shared/http-error.js';

type ShortUrlResponse = ShortUrl & { shortUrl: string };

interface ErrorResponse {
  error: { code: string; message: string };
}

describe('módulo urls (HTTP)', () => {
  let db: Database.Database;
  let server: Server;
  let baseUrl: string;
  let ana: AuthResult;
  let beto: AuthResult;

  beforeAll(async () => {
    db = createDatabase(':memory:');
    server = createApp({ db, jwtSecret: 'test', saltRounds: 4 }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    ana = await register('ana@example.com', 'Ana');
    beto = await register('beto@example.com', 'Beto');
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    db.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM urls');
  });

  async function register(email: string, name: string): Promise<AuthResult> {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'contraseña-segura', name }),
    });
    return (await res.json()) as AuthResult;
  }

  function shorten(body: unknown, token: string | undefined = ana.token): Promise<Response> {
    return fetch(`${baseUrl}/urls`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
  }

  async function createUrl(url: string, token = ana.token): Promise<ShortUrlResponse> {
    return (await (await shorten({ url }, token)).json()) as ShortUrlResponse;
  }

  function remove(code: string, token?: string): Promise<Response> {
    return fetch(`${baseUrl}/urls/${code}`, {
      method: 'DELETE',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  function countUrls(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM urls').get() as { n: number }).n;
  }

  describe('POST /urls (protegido)', () => {
    it('crea un código corto asociado al usuario autenticado', async () => {
      const res = await shorten({ url: 'https://example.com/un/camino/muy/largo?x=1' });
      const body = (await res.json()) as ShortUrlResponse;

      expect(res.status).toBe(201);
      expect(body.code).toMatch(CODE_PATTERN);
      expect(body.originalUrl).toBe('https://example.com/un/camino/muy/largo?x=1');
      expect(body.userId).toBe(ana.user.id);
      expect(body.shortUrl).toBe(`${baseUrl}/${body.code}`);
      expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);

      const row = db
        .prepare('SELECT original_url, user_id FROM urls WHERE code = ?')
        .get(body.code);
      expect(row).toEqual({
        original_url: 'https://example.com/un/camino/muy/largo?x=1',
        user_id: ana.user.id,
      });
    });

    it('genera códigos distintos para la misma URL', async () => {
      const a = await createUrl('https://example.com');
      const b = await createUrl('https://example.com');

      expect(a.code).not.toBe(b.code);
    });

    it.each([
      ['sin token', undefined, 'MISSING_TOKEN'],
      ['con token inválido', 'no-soy-un-jwt', 'INVALID_TOKEN'],
    ])('responde 401 %s y no crea nada', async (_caso, token, code) => {
      const res = await shorten({ url: 'https://example.com' }, token ?? '');
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(401);
      expect(body.error.code).toBe(code);
      expect(countUrls()).toBe(0);
    });

    it('comprueba la autenticación antes que el body', async () => {
      const res = await shorten({}, '');

      expect(res.status).toBe(401);
    });

    it.each([
      ['sin campo url', {}],
      ['url que no es texto', { url: 123 }],
      ['texto que no es URL', { url: 'no soy una url' }],
      ['esquema no permitido', { url: 'javascript:alert(1)' }],
      ['esquema ftp', { url: 'ftp://example.com/archivo' }],
      ['URL demasiado larga', { url: `https://example.com/${'a'.repeat(2048)}` }],
    ])('responde 400 INVALID_URL con %s', async (_caso, body) => {
      const res = await shorten(body);
      const json = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(400);
      expect(json.error.code).toBe('INVALID_URL');
      expect(countUrls()).toBe(0);
    });
  });

  describe('GET /urls (público)', () => {
    it('devuelve una lista vacía si no hay URLs', async () => {
      const res = await fetch(`${baseUrl}/urls`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('lista sin token las URLs de todos, de la más reciente a la más antigua', async () => {
      await createUrl('https://primera.com/', ana.token);
      await createUrl('https://segunda.com/', beto.token);

      const res = await fetch(`${baseUrl}/urls`);
      const body = (await res.json()) as ShortUrlResponse[];

      expect(res.status).toBe(200);
      expect(body.map((u) => [u.originalUrl, u.userId])).toEqual([
        ['https://segunda.com/', beto.user.id],
        ['https://primera.com/', ana.user.id],
      ]);
      expect(body[0]?.shortUrl).toBe(`${baseUrl}/${body[0]?.code}`);
    });
  });

  describe('GET /:code (público)', () => {
    it('redirige sin token con 302 a la URL original', async () => {
      const { code } = await createUrl('https://example.com/destino');

      const res = await fetch(`${baseUrl}/${code}`, { redirect: 'manual' });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://example.com/destino');
    });

    it('responde 404 URL_NOT_FOUND para un código inexistente', async () => {
      const res = await fetch(`${baseUrl}/Zz9Zz9Z`, { redirect: 'manual' });
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(404);
      expect(body.error.code).toBe('URL_NOT_FOUND');
    });

    it('deja pasar al 404 genérico lo que no tiene forma de código', async () => {
      const res = await fetch(`${baseUrl}/favicon.ico`, { redirect: 'manual' });
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(404);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /urls/:code (protegido)', () => {
    it('el dueño la borra: 204 y el código deja de redirigir', async () => {
      const { code } = await createUrl('https://example.com/borrar');

      const res = await remove(code, ana.token);

      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(countUrls()).toBe(0);
      const redirect = await fetch(`${baseUrl}/${code}`, { redirect: 'manual' });
      expect(redirect.status).toBe(404);
    });

    it('responde 403 FORBIDDEN si la URL es de otro usuario y no la borra', async () => {
      const { code } = await createUrl('https://example.com/de-ana', ana.token);

      const res = await remove(code, beto.token);
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(403);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(countUrls()).toBe(1);
    });

    it('responde 403 si la URL no tiene dueño (creada antes de la autenticación)', async () => {
      db.prepare("INSERT INTO urls (code, original_url) VALUES ('Legacy1', 'https://viejo.com/')").run();

      const res = await remove('Legacy1', ana.token);

      expect(res.status).toBe(403);
      expect(countUrls()).toBe(1);
    });

    it('responde 401 sin token y no borra nada', async () => {
      const { code } = await createUrl('https://example.com');

      const res = await remove(code);
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(401);
      expect(body.error.code).toBe('MISSING_TOKEN');
      expect(countUrls()).toBe(1);
    });

    it('responde 404 URL_NOT_FOUND si el código no existe', async () => {
      const res = await remove('Zz9Zz9Z', ana.token);
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(404);
      expect(body.error.code).toBe('URL_NOT_FOUND');
    });
  });
});

describe('urlsService (unitario)', () => {
  let db: Database.Database;
  let userId: number;

  beforeEach(() => {
    db = createDatabase(':memory:');
    userId = Number(
      db
        .prepare("INSERT INTO users (email, password_hash, name) VALUES ('a@b.com', 'x', 'A')")
        .run().lastInsertRowid,
    );
  });

  describe('shorten (colisiones)', () => {
    it('reintenta con otro código si el generado ya existe', () => {
      const codes = ['AAAAAAA', 'AAAAAAA', 'BBBBBBB'];
      const service = createUrlsService(createUrlsRepository(db), {
        generateCode: () => codes.shift() ?? 'ZZZZZZZ',
      });

      expect(service.shorten('https://uno.com', userId).code).toBe('AAAAAAA');
      expect(service.shorten('https://dos.com', userId).code).toBe('BBBBBBB');
      db.close();
    });

    it('falla con CODE_GENERATION_FAILED si agota los intentos', () => {
      const service = createUrlsService(createUrlsRepository(db), {
        generateCode: () => 'AAAAAAA',
      });
      service.shorten('https://uno.com', userId);

      try {
        service.shorten('https://dos.com', userId);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).code).toBe('CODE_GENERATION_FAILED');
      }
      db.close();
    });
  });

  it('borrar un usuario borra sus URLs (ON DELETE CASCADE)', () => {
    const service = createUrlsService(createUrlsRepository(db));
    service.shorten('https://uno.com', userId);

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    expect(service.list()).toEqual([]);
    db.close();
  });
});
