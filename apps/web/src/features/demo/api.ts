import { AppConfigSchema } from '@officepm/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

/**
 * What the server says about itself before anyone signs in: today, only whether this is
 * the public demo. A failed answer is treated as "not the demo", so the page never
 * blocks on it or shows an error for it.
 */
export const appConfigQuery = queryOptions({
  queryKey: qk.config,
  queryFn: ({ signal }) => api.get('/api/config', AppConfigSchema, { signal }),
  staleTime: Infinity,
  retry: false,
});

export function useAppConfig() {
  return useQuery(appConfigQuery);
}
