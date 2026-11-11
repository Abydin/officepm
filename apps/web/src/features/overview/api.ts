import { DashboardSchema } from '@officepm/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

export const dashboardQuery = queryOptions({
  queryKey: qk.dashboard,
  queryFn: ({ signal }) => api.get('/api/dashboard', DashboardSchema, { signal }),
});
