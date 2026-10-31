import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from './http-error.js';

interface ErrorBody {
  error: { code: string; message: string };
}

// Errores de body-parser y similares: traen `status` y `expose` (seguro mostrar el mensaje).
interface ExposableError {
  status: number;
  expose?: boolean;
  type?: string;
  message: string;
}

function isExposableError(err: unknown): err is ExposableError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Ruta no encontrada: ${req.method} ${req.path}`, 'NOT_FOUND'));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  let status = 500;
  let body: ErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
  };

  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message } };
  } else if (isExposableError(err) && err.status >= 400 && err.status < 500) {
    status = err.status;
    const code = err.type === 'entity.parse.failed' ? 'INVALID_JSON' : 'BAD_REQUEST';
    const message = err.expose ? err.message : 'Petición inválida';
    body = { error: { code, message } };
  }

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json(body);
};
