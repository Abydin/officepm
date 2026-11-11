import type { ErrorBody } from '@officepm/shared';

/** An error that maps straight to a status code and a `{ error }` JSON body. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
  }

  toBody(): ErrorBody {
    return { error: this.message };
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
