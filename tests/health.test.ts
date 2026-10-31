import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';

describe('GET /health', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp({ db: createDatabase(':memory:'), jwtSecret: 'test' }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('responde 200 con status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = (await res.json()) as { status: string; uptime: number };

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });
});
