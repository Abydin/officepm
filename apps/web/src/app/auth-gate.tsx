import { Navigate, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { useSession } from '@/features/auth/api';
import { ForcedPasswordChange } from '@/features/auth/forced-password-change';
import { UserProvider } from '@/features/auth/user-context';
import { errorMessage } from '@/lib/api';

/**
 * Layout route for everything behind login. Unknown session: wait. No session:
 * go to /login and remember where the person was headed. A person who has to choose a new
 * password sees only that screen. Session check failed
 * (server down): say so and offer a retry, rather than showing a login form
 * that cannot work.
 */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return (
      <p role="status" className="p-6 text-dim">
        Loading OfficePM...
      </p>
    );
  }
  if (session.isError) {
    return (
      <main className="mx-auto max-w-md p-6">
        <ErrorAlert className="mb-4">{errorMessage(session.error)}</ErrorAlert>
        <Button onClick={() => void session.refetch()}>Try again</Button>
      </main>
    );
  }
  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  // The server refuses everything else until this is done, so nothing else is offered.
  if (session.data.mustChangePassword) return <ForcedPasswordChange email={session.data.email} />;
  return (
    <UserProvider user={session.data}>
      <Outlet />
    </UserProvider>
  );
}
