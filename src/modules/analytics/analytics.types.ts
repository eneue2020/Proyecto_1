/** Datos de la petición que se guardan con cada visita. */
export interface ClickInfo {
  ip: string | undefined;
  referrer: string | undefined;
  userAgent: string | undefined;
}
