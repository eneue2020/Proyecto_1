export interface DashboardTotals {
  urls: number;
  clicks: number;
  lastClickAt: string | null;
}

export interface DailyClicks {
  /** Día UTC en formato `YYYY-MM-DD`. */
  date: string;
  clicks: number;
}

export interface PeriodComparison {
  current: number;
  previous: number;
  currentUniqueVisitors: number;
}

export interface DashboardTrend extends PeriodComparison {
  /** `null` si el periodo anterior no tuvo clicks (no hay base con la que comparar). */
  changePercent: number | null;
  /** Un elemento por día del periodo, en orden ascendente, con 0 los días sin clicks. */
  daily: DailyClicks[];
}

export interface UrlStats {
  code: string;
  originalUrl: string;
  createdAt: string;
  totalClicks: number;
  periodClicks: number;
  lastClickAt: string | null;
}

export interface Dashboard {
  period: { days: number; from: string; to: string; timezone: 'UTC' };
  totals: DashboardTotals;
  trend: DashboardTrend;
  /** Como mucho `URLS_LIMIT`, las de más clicks en el periodo primero; el total está en `totals.urls`. */
  urls: UrlStats[];
}
