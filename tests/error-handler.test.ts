import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import { errorHandler } from '../src/shared/error-handler.js';
import { HttpError } from '../src/shared/http-error.js';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

describe('manejo de errores en la app', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp({ db: createDatabase(':memory:'), jwtSecret: 'test' }).listen(0);
    baseUrl = await listen(server);
  });

  afterAll(() => close(server));

  it('responde 404 en JSON para rutas inexistentes', async () => {
    const res = await fetch(`${baseUrl}/no-existe`);
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('responde 400 cuando el JSON es inválido', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ invalido',
    });
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_JSON');
  });
});

describe('errorHandler', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.get('/http-error', () => {
      throw new HttpError(409, 'Ya existe', 'CONFLICT');
    });
    app.get('/boom', async () => {
      throw new Error('detalle interno');
    });
    app.use(errorHandler);
    server = app.listen(0);
    baseUrl = await listen(server);
  });

  afterAll(() => close(server));

  it('usa status, código y mensaje de un HttpError', async () => {
    const res = await fetch(`${baseUrl}/http-error`);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({ error: { code: 'CONFLICT', message: 'Ya existe' } });
  });

  it('oculta los detalles de errores inesperados y responde 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await fetch(`${baseUrl}/boom`);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
