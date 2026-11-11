import { render } from '@testing-library/react';
import { RouterProvider } from 'react-router/dom';
import { vi } from 'vitest';
import { App } from '@/app/App';
import { createQueryClient } from '@/app/query-client';
import { createTestRouter } from '@/app/router';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Handler = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;

/**
 * Replaces global fetch with a router keyed by "METHOD /path" (query string
 * ignored). An unrouted request fails the test loudly instead of hanging.
 */
export function stubApi(routes: Record<string, Handler | Response | object>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`Unrouted request in test: ${key}`);
    if (typeof route === 'function') return route(init, url);
    return route instanceof Response ? route.clone() : jsonResponse(route);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const demoUser = {
  id: 1,
  email: 'maya.okafor@officepm.demo',
  name: 'Maya Okafor',
  isAdmin: true,
};

/** Renders the whole app at a route, with a fresh query client that does not retry. */
export function renderApp(path: string) {
  const client = createQueryClient({ queries: { retry: false, staleTime: 0 } });
  const router = createTestRouter([path]);
  const view = render(<App client={client} router={router as never} />);
  return { ...view, client, router };
}

export { RouterProvider };
