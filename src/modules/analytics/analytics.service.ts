import { createHmac } from 'node:crypto';
import type { AnalyticsRepository } from './analytics.repository.js';
import type { ClickInfo } from './analytics.types.js';

const MAX_REFERRER_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 256;
// 22 caracteres base64url = 132 bits: sobra para distinguir visitantes y el índice ocupa poco.
const IP_HASH_LENGTH = 22;

export interface AnalyticsService {
  recordClick(code: string, info: ClickInfo): void;
}

export function createAnalyticsService(
  repository: AnalyticsRepository,
  options: { hashSecret: string },
): AnalyticsService {
  if (!options.hashSecret) {
    throw new Error('hashSecret es obligatorio');
  }

  // HMAC y no un hash simple: sin el secreto no se puede recuperar la IP probando las 2^32.
  const hashIp = (ip: string) =>
    createHmac('sha256', options.hashSecret).update(ip).digest('base64url').slice(0, IP_HASH_LENGTH);

  return {
    recordClick(code, { ip, referrer, userAgent }) {
      // La analítica nunca debe romper la redirección: si falla, se registra y se sigue.
      try {
        repository.recordClick(
          code,
          truncate(referrer, MAX_REFERRER_LENGTH),
          truncate(userAgent, MAX_USER_AGENT_LENGTH),
          ip ? hashIp(ip) : null,
        );
      } catch (err) {
        console.error('No se pudo registrar el click:', err);
      }
    },
  };
}

function truncate(value: string | undefined, maxLength: number): string | null {
  return value ? value.slice(0, maxLength) : null;
}
