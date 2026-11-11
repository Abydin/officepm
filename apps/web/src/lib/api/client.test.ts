import { ErrorBodySchema, OkSchema } from '@officepm/shared';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientWith(fetchImpl: typeof fetch, onUnauthorized?: (e: ApiError) => void) {
  return createApiClient({ fetch: fetchImpl, onUnauthorized });
}

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('expected the request to fail');
}

describe('api client', () => {
  it('returns the parsed body, sends cookies same-origin, and builds the query string', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ ok: true }));
    const result = await clientWith(fetchMock).get('/api/x', OkSchema, {
      query: { a: 1, b: 'two', skip: undefined, empty: '' },
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/x?a=1&b=two');
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('GET');
  });

  it('sends a JSON body with a content type, and leaves FormData alone', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ ok: true }));
    const client = clientWith(fetchMock);

    await client.post('/api/x', OkSchema, { title: 'hi' });
    const jsonInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(jsonInit.body).toBe('{"title":"hi"}');
    expect(jsonInit.headers).toEqual({ 'Content-Type': 'application/json' });

    const form = new FormData();
    form.append('file', new Blob(['x']), 'x.txt');
    await client.post('/api/x', OkSchema, form);
    const formInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(formInit.body).toBe(form);
    expect(formInit.headers).toBeUndefined();
  });

  it("uses the server's error message on a non-2xx answer", async () => {
    const client = clientWith(async () => json({ error: 'invalid email or password' }, 401));
    const error = await failureOf(client.post('/api/login', OkSchema, {}));
    expect(error).toMatchObject({
      kind: 'http',
      status: 401,
      message: 'invalid email or password',
    });
  });

  it('falls back to "HTTP <status>" when the error body is not the shared shape', async () => {
    const html = clientWith(async () => new Response('<h1>Bad gateway</h1>', { status: 502 }));
    expect(await failureOf(html.get('/api/x', OkSchema))).toMatchObject({
      kind: 'http',
      status: 502,
      message: 'HTTP 502',
    });

    const odd = clientWith(async () => json({ message: 'nope' }, 500));
    expect(await failureOf(odd.get('/api/x', OkSchema))).toMatchObject({
      kind: 'http',
      status: 500,
      message: 'HTTP 500',
    });
    // The shared error shape is what the first branch relies on.
    expect(ErrorBodySchema.safeParse({ message: 'nope' }).success).toBe(false);
  });

  it('reports a network failure as its own kind with status 0', async () => {
    const client = clientWith(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await failureOf(client.get('/api/x', OkSchema));
    expect(error).toMatchObject({ kind: 'network', status: 0 });
    expect(error.message).toMatch(/could not reach the server/i);
  });

  it('lets an aborted request through untouched, so callers can tell cancel from failure', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const client = clientWith(async () => {
      throw abort;
    });
    await expect(client.get('/api/x', OkSchema)).rejects.toBe(abort);
  });

  it('rejects a 2xx body that does not match the schema', async () => {
    const client = clientWith(async () => json({ ok: false }));
    const error = await failureOf(client.get('/api/x', OkSchema));
    expect(error).toMatchObject({ kind: 'invalid-response', status: 200 });
    expect(error.cause).toBeDefined();
  });

  it('rejects a 2xx answer that is not JSON', async () => {
    const client = clientWith(async () => new Response('hello', { status: 200 }));
    expect(await failureOf(client.get('/api/x', OkSchema))).toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('calls the unauthorized handler for a 401 and for nothing else', async () => {
    const onUnauthorized = vi.fn();
    let status = 401;
    const client = clientWith(
      async () => json({ error: 'sign in required' }, status),
      onUnauthorized,
    );

    await failureOf(client.get('/api/me', OkSchema));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    status = 403;
    await failureOf(client.get('/api/me', OkSchema));
    status = 500;
    await failureOf(client.get('/api/me', OkSchema));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('exposes isUnauthorized only for an http 401', () => {
    expect(new ApiError('http', 401, 'x').isUnauthorized).toBe(true);
    expect(new ApiError('http', 403, 'x').isUnauthorized).toBe(false);
    expect(new ApiError('network', 0, 'x').isUnauthorized).toBe(false);
  });
});
