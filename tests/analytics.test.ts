import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import type { AnalyticsRepository } from '../src/modules/analytics/analytics.repository.js';
import { createAnalyticsService } from '../src/modules/analytics/analytics.service.js';
import type { AuthResult } from '../src/modules/auth/auth.types.js';
import type { ShortUrl } from '../src/modules/urls/urls.types.js';

interface ClickRow {
  referrer: string | null;
  user_agent: string | null;
  ip_hash: string | null;
}

describe('registro de clicks en la redirección (HTTP)', () => {
  let db: Database.Database;
  let server: Server;
  let baseUrl: string;
  let ana: AuthResult;

  beforeAll(async () => {
    db = createDatabase(':memory:');
    server = createApp({ db, jwtSecret: 'test', saltRounds: 4 }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ana@example.com', password: 'contraseña-segura', name: 'Ana' }),
    });
    ana = (await res.json()) as AuthResult;
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

  async function createUrl(url: string): Promise<ShortUrl> {
    const res = await fetch(`${baseUrl}/urls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ana.token}` },
      body: JSON.stringify({ url }),
    });
    return (await res.json()) as ShortUrl;
  }

  function visit(code: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}/${code}`, { redirect: 'manual', ...init });
  }

  function clicks(): ClickRow[] {
    return db.prepare<[], ClickRow>('SELECT referrer, user_agent, ip_hash FROM clicks').all();
  }

  function counters(code: string) {
    return db
      .prepare<[string], { click_count: number; last_click_at: string | null }>(
        'SELECT click_count, last_click_at FROM urls WHERE code = ?',
      )
      .get(code);
  }

  it('cada GET registra un click con referrer, user agent y la IP anonimizada', async () => {
    const { code } = await createUrl('https://example.com/');

    const res = await visit(code, {
      headers: { referer: 'https://t.co/abc', 'user-agent': 'TestAgent/1.0' },
    });

    expect(res.status).toBe(302);
    const [click] = clicks();
    expect(click).toMatchObject({ referrer: 'https://t.co/abc', user_agent: 'TestAgent/1.0' });
    // HMAC truncado a 22 caracteres base64url: nunca la IP en claro.
    expect(click?.ip_hash).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(click?.ip_hash).not.toContain('127');
  });

  it('la misma IP produce siempre el mismo hash (visitantes únicos)', async () => {
    const { code } = await createUrl('https://example.com/');

    await visit(code);
    await visit(code);

    const [a, b] = clicks();
    expect(a?.ip_hash).toBe(b?.ip_hash);
  });

  it('mantiene click_count y last_click_at iguales a lo que hay en clicks', async () => {
    const { code } = await createUrl('https://example.com/');

    for (let i = 0; i < 3; i++) {
      await visit(code);
    }

    const real = db
      .prepare('SELECT COUNT(*) AS n, MAX(clicked_at) AS last FROM clicks')
      .get() as { n: number; last: string };
    expect(counters(code)).toEqual({ click_count: 3, last_click_at: real.last });
    expect(real.n).toBe(3);
  });

  it('una petición HEAD redirige pero no cuenta como click', async () => {
    const { code } = await createUrl('https://example.com/');

    const res = await visit(code, { method: 'HEAD' });

    expect(res.status).toBe(302);
    expect(clicks()).toEqual([]);
    expect(counters(code)?.click_count).toBe(0);
  });

  it('un código inexistente responde 404 y no registra nada', async () => {
    const res = await visit('Zz9Zz9Z');

    expect(res.status).toBe(404);
    expect(clicks()).toEqual([]);
  });

  it('recorta un user agent desmesurado a 256 caracteres', async () => {
    const { code } = await createUrl('https://example.com/');

    await visit(code, { headers: { 'user-agent': 'x'.repeat(5000) } });

    expect(clicks()[0]?.user_agent).toHaveLength(256);
  });
});

describe('analyticsService (unitario)', () => {
  it('si el registro falla, lo deja en el log y no lanza (la redirección sigue)', () => {
    const repository: AnalyticsRepository = {
      recordClick: () => {
        throw new Error('disco lleno');
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = createAnalyticsService(repository, { hashSecret: 's' });

    expect(() =>
      service.recordClick('AAAAAAA', { ip: '1.2.3.4', referrer: undefined, userAgent: undefined }),
    ).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('el hash depende del secreto', () => {
    const hashes: (string | null)[] = [];
    const repository: AnalyticsRepository = {
      recordClick: (_code, _referrer, _userAgent, ipHash) => {
        hashes.push(ipHash);
        return true;
      },
    };
    const info = { ip: '1.2.3.4', referrer: undefined, userAgent: undefined };

    createAnalyticsService(repository, { hashSecret: 'uno' }).recordClick('AAAAAAA', info);
    createAnalyticsService(repository, { hashSecret: 'dos' }).recordClick('AAAAAAA', info);

    expect(hashes[0]).not.toBe(hashes[1]);
  });
});
