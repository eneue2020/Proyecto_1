import { randomInt } from 'node:crypto';
import { HttpError } from '../../shared/http-error.js';
import type { UrlsRepository } from './urls.repository.js';
import type { ShortUrl } from './urls.types.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 7;
const MAX_ATTEMPTS = 5;
const MAX_URL_LENGTH = 2048;

export const CODE_PATTERN = new RegExp(`^[A-Za-z0-9]{${CODE_LENGTH}}$`);

export function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return code;
}

export interface UrlsService {
  shorten(originalUrl: string, userId: number): ShortUrl;
  resolve(code: string): string;
  list(): ShortUrl[];
  remove(code: string, userId: number): void;
}

export function createUrlsService(
  repository: UrlsRepository,
  options: { generateCode?: () => string } = {},
): UrlsService {
  const nextCode = options.generateCode ?? generateCode;

  return {
    shorten(originalUrl, userId) {
      const url = normalizeUrl(originalUrl);

      // Con 62^7 combinaciones una colisión es rarísima, pero si ocurre se reintenta.
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const created = repository.insert(nextCode(), url, userId);
        if (created) {
          return created;
        }
      }
      throw new HttpError(500, 'No se pudo generar un código único', 'CODE_GENERATION_FAILED');
    },

    resolve(code) {
      const found = repository.findByCode(code);
      if (!found) {
        throw new HttpError(404, `Código no encontrado: ${code}`, 'URL_NOT_FOUND');
      }
      return found.originalUrl;
    },

    list() {
      return repository.findAll();
    },

    remove(code, userId) {
      const found = repository.findByCode(code);
      if (!found) {
        throw new HttpError(404, `Código no encontrado: ${code}`, 'URL_NOT_FOUND');
      }
      // Las URLs sin dueño (anteriores a la autenticación) no las puede borrar nadie.
      if (found.userId !== userId) {
        throw new HttpError(403, 'No puedes borrar una URL que no es tuya', 'FORBIDDEN');
      }
      repository.deleteByCode(code);
    },
  };
}

function normalizeUrl(input: string): string {
  if (input.length > MAX_URL_LENGTH) {
    throw new HttpError(400, `La URL supera los ${MAX_URL_LENGTH} caracteres`, 'INVALID_URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new HttpError(400, 'La URL no es válida', 'INVALID_URL');
  }

  // Solo http/https: evita redirigir a esquemas como javascript: o data:.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'La URL debe usar http o https', 'INVALID_URL');
  }

  return parsed.href;
}
