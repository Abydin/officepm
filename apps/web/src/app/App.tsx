import type { QueryClient } from '@tanstack/react-query';
import { DemoBanner } from '@/features/demo/demo-banner';
import { RouterProvider } from 'react-router/dom';
import type { createAppRouter } from './router';
import { Providers } from './providers';

export function App({
  client,
  router,
}: {
  client: QueryClient;
  router: ReturnType<typeof createAppRouter>;
}) {
  return (
    <Providers client={client}>
      <DemoBanner />
      <RouterProvider router={router} />
    </Providers>
  );
}
