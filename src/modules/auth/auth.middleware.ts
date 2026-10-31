import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from '../../shared/http-error.js';
import type { AuthenticatedUser } from './auth.types.js';

declare global {
  namespace Express {
    interface Request {
      /** Presente solo en rutas protegidas por `requireAuth`. */
      user?: AuthenticatedUser;
    }
  }
}

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export function createAuthMiddleware(jwtSecret: string): RequestHandler {
  if (!jwtSecret) {
    throw new Error('jwtSecret es obligatorio');
  }

  return (req, res, next) => {
    // RFC 6750: los 401 de un recurso con Bearer deben anunciar el esquema.
    res.setHeader('WWW-Authenticate', 'Bearer');

    const token = BEARER_PATTERN.exec(req.get('authorization') ?? '')?.[1];
    if (!token) {
      throw new HttpError(401, 'Falta el token de autenticación', 'MISSING_TOKEN');
    }

    req.user = verifyToken(token, jwtSecret);
    res.removeHeader('WWW-Authenticate');
    next();
  };
}

/** Para handlers montados detrás del middleware: devuelve `req.user` ya sin `undefined`. */
export function getAuthUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw new HttpError(401, 'Falta el token de autenticación', 'MISSING_TOKEN');
  }
  return req.user;
}

function verifyToken(token: string, jwtSecret: string): AuthenticatedUser {
  let payload: string | jwt.JwtPayload;
  try {
    // Fijar el algoritmo evita aceptar tokens con `alg: none` u otro algoritmo.
    payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, 'El token ha expirado', 'TOKEN_EXPIRED');
    }
    throw new HttpError(401, 'El token no es válido', 'INVALID_TOKEN');
  }

  const id = typeof payload === 'object' ? Number(payload.sub) : NaN;
  const email = typeof payload === 'object' ? payload['email'] : undefined;
  if (!Number.isInteger(id) || id <= 0 || typeof email !== 'string') {
    throw new HttpError(401, 'El token no es válido', 'INVALID_TOKEN');
  }

  return { id, email };
}
