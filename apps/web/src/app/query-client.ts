import {
  MutationCache,
  QueryCache,
  QueryClient,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { api, isApiError, qk } from '@/lib/api';

/** Client errors (4xx) will not fix themselves on retry; server and network errors might. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.kind === 'http' && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(
  overrides: QueryClientConfig['defaultOptions'] = {},
): QueryClient {
  const client = new QueryClient({
    queryCache: new QueryCache(),
    mutationCache: new MutationCache(),
    defaultOptions: {
      ...overrides,
      queries: { staleTime: 15_000, retry: shouldRetry, ...overrides.queries },
    },
  });
  // Any 401 means the session is gone (expired, or the server restarted): drop it
  // and the auth gate sends the person to the login page.
  api.setUnauthorizedHandler(() => client.setQueryData(qk.session, null));
  return client;
}
