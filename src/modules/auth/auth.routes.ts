import { Router, type Request } from 'express';
import { HttpError } from '../../shared/http-error.js';
import type { AuthService } from './auth.service.js';

function requireStrings<K extends string>(req: Request, fields: readonly K[]): Record<K, string> {
  const body: unknown = req.body;
  const values = {} as Record<K, string>;

  for (const field of fields) {
    const value: unknown =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[field] : undefined;
    if (typeof value !== 'string') {
      throw new HttpError(
        400,
        `El campo "${field}" es obligatorio y debe ser un texto`,
        'INVALID_INPUT',
      );
    }
    values[field] = value;
  }

  return values;
}

export function createAuthRouter(service: AuthService): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const input = requireStrings(req, ['email', 'password', 'name']);
    res.status(201).json(await service.register(input));
  });

  router.post('/login', async (req, res) => {
    const input = requireStrings(req, ['email', 'password']);
    res.status(200).json(await service.login(input));
  });

  return router;
}
