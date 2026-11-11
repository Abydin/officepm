import { ErrorBodySchema } from '@officepm/shared';
import { ApiError } from './errors';

/** Anything with a Zod-style `parse`. The shared schemas satisfy it. */
export interface ResponseSchema<T> {
  parse(input: unknown): T;
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions<T> {
  schema: ResponseSchema<T>;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Sent as JSON, or as-is when it is a FormData (uploads). */
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Called for any 401, so the app can drop its session and show the login page. */
  onUnauthorized?: (error: ApiError) => void;
}

export interface ApiClient {
  request<T>(path: string, options: RequestOptions<T>): Promise<T>;
  get<T>(
    path: string,
    schema: ResponseSchema<T>,
    options?: Omit<RequestOptions<T>, 'schema'>,
  ): Promise<T>;
  post<T>(
    path: string,
    schema: ResponseSchema<T>,
    body?: unknown,
    options?: Omit<RequestOptions<T>, 'schema' | 'body'>,
  ): Promise<T>;
  patch<T>(
    path: string,
    schema: ResponseSchema<T>,
    body?: unknown,
    options?: Omit<RequestOptions<T>, 'schema' | 'body'>,
  ): Promise<T>;
  delete<T>(
    path: string,
    schema: ResponseSchema<T>,
    options?: Omit<RequestOptions<T>, 'schema'>,
  ): Promise<T>;
  /** Replaces the 401 handler. The app installs it once the query client exists. */
  setUnauthorizedHandler(handler: ((error: ApiError) => void) | undefined): void;
}

function withQuery(path: string, query: QueryParams | undefined): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? path + (path.includes('?') ? '&' : '?') + text : path;
}

async function readJson(res: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await res.text();
  if (!text) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? '';
  let onUnauthorized = options.onUnauthorized;

  async function request<T>(path: string, opts: RequestOptions<T>): Promise<T> {
    const method = opts.method ?? 'GET';
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    const hasBody = opts.body !== undefined;
    const init: RequestInit = {
      method,
      credentials: 'same-origin',
      headers: hasBody && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? (isForm ? (opts.body as FormData) : JSON.stringify(opts.body)) : undefined,
      signal: opts.signal,
    };

    // Resolved per call, not captured at creation, so a test can stub the global.
    const doFetch = options.fetch ?? globalThis.fetch;
    let res: Response;
    try {
      res = await doFetch(baseUrl + withQuery(path, opts.query), init);
    } catch (cause) {
      // An aborted request is the caller's doing (TanStack Query cancels on unmount): pass it on.
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new ApiError(
        'network',
        0,
        'Could not reach the server. Check your connection and try again.',
        { cause },
      );
    }

    const parsed = await readJson(res);

    if (!res.ok) {
      const body = parsed.ok ? ErrorBodySchema.safeParse(parsed.value) : null;
      const error = new ApiError(
        'http',
        res.status,
        body?.success ? body.data.error : 'HTTP ' + res.status,
      );
      if (error.isUnauthorized) onUnauthorized?.(error);
      throw error;
    }

    if (!parsed.ok) {
      throw new ApiError(
        'invalid-response',
        res.status,
        'The server sent a reply that is not valid JSON.',
      );
    }
    try {
      return opts.schema.parse(parsed.value);
    } catch (cause) {
      throw new ApiError(
        'invalid-response',
        res.status,
        'The server sent a reply this version of the app does not understand.',
        { cause },
      );
    }
  }

  return {
    request,
    get: (path, schema, o) => request(path, { ...o, schema, method: 'GET' }),
    post: (path, schema, body, o) =>
      request(path, { ...o, schema, body: body ?? {}, method: 'POST' }),
    patch: (path, schema, body, o) =>
      request(path, { ...o, schema, body: body ?? {}, method: 'PATCH' }),
    delete: (path, schema, o) => request(path, { ...o, schema, method: 'DELETE' }),
    setUnauthorizedHandler(handler) {
      onUnauthorized = handler;
    },
  };
}
