/**
 * - `http`: the server answered with a non-2xx status.
 * - `network`: no answer at all (offline, server down, request aborted by a proxy).
 * - `invalid-response`: a 2xx answer that is not JSON or does not match the shared schema.
 */
export type ApiErrorKind = 'http' | 'network' | 'invalid-response';

/** The one error type the API client throws. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status for `http` and `invalid-response`, 0 for `network`. */
  readonly status: number;

  constructor(kind: ApiErrorKind, status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }

  get isUnauthorized(): boolean {
    return this.kind === 'http' && this.status === 401;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** A message safe to show a person, whatever was thrown. */
export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong.';
}
