import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';

/** Shown when a route throws while rendering, and for paths that match nothing. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="mb-2 text-[22px] font-semibold">
        {notFound ? 'Page not found' : 'Something broke'}
      </h1>
      <p className="mb-4 text-dim">
        {notFound ? 'That address does not lead anywhere in OfficePM.' : errorMessage(error)}
      </p>
      <Button asChild variant="primary">
        <Link to="/">Back to the overview</Link>
      </Button>
    </main>
  );
}
