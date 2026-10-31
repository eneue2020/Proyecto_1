import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import type { AuthResult } from '../src/modules/auth/auth.types.js';
import { URLS_LIMIT } from '../src/modules/dashboard/dashboard.service.js';
import type { Dashboard, UrlStats } from '../src/modules/dashboard/dashboard.types.js';
import type { ShortUrl } from '../src/modules/urls/urls.types.js';

type DashboardResponse = Dashboard & { urls: (UrlStats & { shortUrl: string })[] };

interface ErrorResponse {
  error: { code: string; message: string };
}

// Reloj fijo: el periodo de 7 días es 2026-10-25..2026-10-31 y el anterior 2026-10-18..2026-10-24.
const NOW = new Date('2026-10-31T12:00:00.000Z');

describe('GET /dashboard', () => {
  let db: Database.Database;
  let server: Server;
  let baseUrl: string;
  let ana: AuthResult;
  let beto: AuthResult;

  beforeAll(async () => {
    db = createDatabase(':memory:');
    server = createApp({ db, jwtSecret: 'test', saltRounds: 4, now: () => NOW }).listen(0);
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
    // Los clicks se borran en cascada.
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

  async function createUrl(url: string, token: string): Promise<string> {
    const res = await fetch(`${baseUrl}/urls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
    });
    return ((await res.json()) as ShortUrl).code;
  }

  /** Inserta clicks con fecha fija; luego hay que llamar a `syncCounters`. */
  function addClicks(code: string, clicks: [clickedAt: string, ipHash: string][]): void {
    const stmt = db.prepare(
      'INSERT INTO clicks (url_id, clicked_at, ip_hash) SELECT id, ?, ? FROM urls WHERE code = ?',
    );
    for (const [clickedAt, ipHash] of clicks) {
      stmt.run(clickedAt, ipHash, code);
    }
  }

  // Deja los contadores como los dejaría el registro real de clicks.
  function syncCounters(): void {
    db.exec(`
      UPDATE urls SET
        click_count   = (SELECT COUNT(*)        FROM clicks WHERE url_id = urls.id),
        last_click_at = (SELECT MAX(clicked_at) FROM clicks WHERE url_id = urls.id)
    `);
  }

  function getDashboard(token?: string, query = ''): Promise<Response> {
    return fetch(`${baseUrl}/dashboard${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  async function dashboardOf(token: string, query = ''): Promise<DashboardResponse> {
    const res = await getDashboard(token, query);
    expect(res.status).toBe(200);
    return (await res.json()) as DashboardResponse;
  }

  describe('autenticación', () => {
    it.each([
      ['sin token', undefined, 'MISSING_TOKEN'],
      ['con token inválido', 'no-soy-un-jwt', 'INVALID_TOKEN'],
    ])('responde 401 %s', async (_caso, token, code) => {
      const res = await getDashboard(token);
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      expect(body.error.code).toBe(code);
    });

    it('comprueba la autenticación antes que el parámetro days', async () => {
      const res = await getDashboard(undefined, '?days=15');

      expect(res.status).toBe(401);
    });
  });

  describe('usuario sin URLs', () => {
    it('devuelve todo a cero, con un día por elemento del periodo por defecto (30)', async () => {
      // Otro usuario con actividad: no debe filtrarse al dashboard de Ana.
      const code = await createUrl('https://beto.com/', beto.token);
      addClicks(code, [['2026-10-30T10:00:00.000Z', 'b1']]);
      syncCounters();

      const body = await dashboardOf(ana.token);

      expect(body.period).toEqual({
        days: 30,
        from: '2026-10-02',
        to: '2026-10-31',
        timezone: 'UTC',
      });
      expect(body.totals).toEqual({ urls: 0, clicks: 0, lastClickAt: null });
      expect(body.trend).toMatchObject({
        current: 0,
        previous: 0,
        changePercent: null,
        currentUniqueVisitors: 0,
      });
      expect(body.trend.daily).toHaveLength(30);
      expect(body.trend.daily[0]).toEqual({ date: '2026-10-02', clicks: 0 });
      expect(body.trend.daily.at(-1)).toEqual({ date: '2026-10-31', clicks: 0 });
      expect(body.trend.daily.every((d) => d.clicks === 0)).toBe(true);
      expect(body.urls).toEqual([]);
    });

    it('una URL sin clicks cuenta en totals.urls pero el resto sigue a cero', async () => {
      await createUrl('https://sin-clicks.com/', ana.token);

      const body = await dashboardOf(ana.token, '?days=7');

      expect(body.totals).toEqual({ urls: 1, clicks: 0, lastClickAt: null });
      expect(body.trend.current).toBe(0);
      expect(body.urls).toEqual([
        expect.objectContaining({ totalClicks: 0, periodClicks: 0, lastClickAt: null }),
      ]);
    });
  });

  describe('usuario con URLs y clicks', () => {
    let a: string;
    let b: string;
    let c: string;

    beforeEach(async () => {
      a = await createUrl('https://a.com/', ana.token);
      b = await createUrl('https://b.com/', ana.token);
      c = await createUrl('https://c.com/', ana.token);
      addClicks(a, [
        ['2026-10-31T08:00:00.000Z', 'h1'],
        ['2026-10-31T09:00:00.000Z', 'h2'],
        ['2026-10-29T23:59:59.999Z', 'h1'],
        ['2026-10-20T10:00:00.000Z', 'h3'], // periodo anterior
        ['2026-09-15T10:00:00.000Z', 'h4'], // fuera de los periodos de 7 días
      ]);
      addClicks(b, [
        ['2026-10-25T00:00:00.000Z', 'h2'], // primer milisegundo del periodo
        ['2026-10-24T23:59:59.999Z', 'h5'], // último milisegundo del anterior
        ['2026-10-17T23:59:59.999Z', 'h6'], // justo antes del periodo anterior
      ]);
      // De otro usuario y sin dueño: no deben contar para Ana.
      const deBeto = await createUrl('https://beto.com/', beto.token);
      addClicks(deBeto, [
        ['2026-10-30T10:00:00.000Z', 'b1'],
        ['2026-10-30T11:00:00.000Z', 'b2'],
      ]);
      db.prepare("INSERT INTO urls (code, original_url) VALUES ('Legacy1', 'https://viejo.com/')").run();
      addClicks('Legacy1', [['2026-10-30T10:00:00.000Z', 'x']]);
      syncCounters();
    });

    it('calcula totales, tendencia, serie diaria y estadísticas por URL', async () => {
      const body = await dashboardOf(ana.token, '?days=7');

      expect(body).toEqual({
        period: { days: 7, from: '2026-10-25', to: '2026-10-31', timezone: 'UTC' },
        totals: { urls: 3, clicks: 8, lastClickAt: '2026-10-31T09:00:00.000Z' },
        trend: {
          current: 4,
          previous: 2,
          changePercent: 100,
          currentUniqueVisitors: 2, // h1 y h2
          daily: [
            { date: '2026-10-25', clicks: 1 },
            { date: '2026-10-26', clicks: 0 },
            { date: '2026-10-27', clicks: 0 },
            { date: '2026-10-28', clicks: 0 },
            { date: '2026-10-29', clicks: 1 },
            { date: '2026-10-30', clicks: 0 },
            { date: '2026-10-31', clicks: 2 },
          ],
        },
        // Ordenadas por clicks en el periodo.
        urls: [
          {
            code: a,
            originalUrl: 'https://a.com/',
            shortUrl: `${baseUrl}/${a}`,
            createdAt: expect.any(String),
            totalClicks: 5,
            periodClicks: 3,
            lastClickAt: '2026-10-31T09:00:00.000Z',
          },
          {
            code: b,
            originalUrl: 'https://b.com/',
            shortUrl: `${baseUrl}/${b}`,
            createdAt: expect.any(String),
            totalClicks: 3,
            periodClicks: 1,
            lastClickAt: '2026-10-25T00:00:00.000Z',
          },
          {
            code: c,
            originalUrl: 'https://c.com/',
            shortUrl: `${baseUrl}/${c}`,
            createdAt: expect.any(String),
            totalClicks: 0,
            periodClicks: 0,
            lastClickAt: null,
          },
        ],
      });
    });

    it('con un periodo más largo, el periodo anterior se desplaza en consecuencia', async () => {
      const body = await dashboardOf(ana.token, '?days=30');

      // Periodo 2026-10-02..31: todo salvo el click del 15-09, que cae en el anterior (09-02..10-01).
      expect(body.trend).toMatchObject({ current: 7, previous: 1, changePercent: 600 });
      expect(body.trend.daily).toHaveLength(30);
      expect(body.trend.daily.reduce((sum, d) => sum + d.clicks, 0)).toBe(7);
    });

    it('cada usuario ve solo sus URLs y sus clicks', async () => {
      const body = await dashboardOf(beto.token, '?days=7');

      expect(body.totals).toEqual({ urls: 1, clicks: 2, lastClickAt: '2026-10-30T11:00:00.000Z' });
      expect(body.trend).toMatchObject({
        current: 2,
        previous: 0,
        changePercent: null,
        currentUniqueVisitors: 2,
      });
      expect(body.urls.map((u) => u.originalUrl)).toEqual(['https://beto.com/']);
    });
  });

  it('refleja los clicks registrados por redirecciones reales', async () => {
    const code = await createUrl('https://real.com/', ana.token);
    for (let i = 0; i < 2; i++) {
      await fetch(`${baseUrl}/${code}`, { redirect: 'manual' });
    }

    const body = await dashboardOf(ana.token);

    // Los contadores no dependen del reloj; periodClicks sí, así que no se comprueba aquí.
    expect(body.totals.clicks).toBe(2);
    expect(body.totals.lastClickAt).not.toBeNull();
    expect(body.urls[0]?.totalClicks).toBe(2);
  });

  it(`devuelve como mucho ${URLS_LIMIT} URLs, pero totals.urls las cuenta todas`, async () => {
    const insert = db.prepare('INSERT INTO urls (code, original_url, user_id) VALUES (?, ?, ?)');
    for (let i = 0; i < URLS_LIMIT + 5; i++) {
      insert.run(`L${String(i).padStart(6, '0')}`, `https://l.com/${i}`, ana.user.id);
    }

    const body = await dashboardOf(ana.token);

    expect(body.totals.urls).toBe(URLS_LIMIT + 5);
    expect(body.urls).toHaveLength(URLS_LIMIT);
  });

  describe('parámetro days', () => {
    it.each(['7', '30', '90'])('acepta days=%s', async (days) => {
      const body = await dashboardOf(ana.token, `?days=${days}`);

      expect(body.period.days).toBe(Number(days));
      expect(body.trend.daily).toHaveLength(Number(days));
    });

    it.each([
      ['un número no permitido', '?days=15'],
      ['un texto', '?days=abc'],
      ['vacío', '?days='],
      ['repetido', '?days=7&days=30'],
    ])('responde 400 INVALID_PERIOD con %s', async (_caso, query) => {
      const res = await getDashboard(ana.token, query);
      const body = (await res.json()) as ErrorResponse;

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('INVALID_PERIOD');
    });
  });
});
