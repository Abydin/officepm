import type { QueryClient } from '@tanstack/react-query';
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
      <RouterProvider router={router} />
    </Providers>
  );
}
