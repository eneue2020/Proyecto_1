export interface ShortUrl {
  code: string;
  originalUrl: string;
  createdAt: string;
  /** `null` en URLs creadas antes de que existiera la autenticación. */
  userId: number | null;
}
