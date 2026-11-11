import { createApiClient } from './client';

export { ApiError, errorMessage, isApiError } from './errors';
export type { ApiErrorKind } from './errors';
export { createApiClient } from './client';
export type { ApiClient, ResponseSchema } from './client';
export { qk } from './keys';

/** The app-wide client. Same-origin: the Vite dev proxy and the production server both mount /api. */
export const api = createApiClient();
