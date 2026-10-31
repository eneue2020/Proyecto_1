export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'HTTP_ERROR',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
