import { HttpError } from '../../shared/http-error.js';
import type { DashboardRepository, PeriodRange } from './dashboard.repository.js';
import type { Dashboard, DailyClicks } from './dashboard.types.js';

export const ALLOWED_DAYS = [7, 30, 90] as const;
export const DEFAULT_DAYS = 30;
export const URLS_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DashboardService {
  get(userId: number, days?: number): Dashboard;
}

export function createDashboardService(
  repository: DashboardRepository,
  options: { now?: () => Date } = {},
): DashboardService {
  const now = options.now ?? (() => new Date());

  return {
    get(userId, days = DEFAULT_DAYS) {
      if (!(ALLOWED_DAYS as readonly number[]).includes(days)) {
        throw new HttpError(
          400,
          `El periodo debe ser uno de: ${ALLOWED_DAYS.join(', ')} días`,
          'INVALID_PERIOD',
        );
      }

      // Días UTC; el periodo incluye hoy y `to` es exclusivo (inicio de mañana).
      const today = startOfUtcDay(now());
      const to = addDays(today, 1);
      const from = addDays(to, -days);
      const range: PeriodRange = {
        userId,
        previousFrom: toDateString(addDays(from, -days)),
        from: toDateString(from),
        to: toDateString(to),
      };

      return repository.read(() => {
        const comparison = repository.periodComparison(range);
        return {
          period: { days, from: range.from, to: toDateString(today), timezone: 'UTC' },
          totals: repository.totals(userId),
          trend: {
            ...comparison,
            changePercent: changePercent(comparison.current, comparison.previous),
            daily: fillMissingDays(repository.dailyClicks(range), from, days),
          },
          urls: repository.urlStats(range, URLS_LIMIT),
        };
      });
    },
  };
}

function fillMissingDays(rows: DailyClicks[], from: Date, days: number): DailyClicks[] {
  const byDate = new Map(rows.map((row) => [row.date, row.clicks]));
  return Array.from({ length: days }, (_, i) => {
    const date = toDateString(addDays(from, i));
    return { date, clicks: byDate.get(date) ?? 0 };
  });
}

function changePercent(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
