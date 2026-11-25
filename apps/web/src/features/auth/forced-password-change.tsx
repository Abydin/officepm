import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { PasswordChangeForm } from './password-form';
import { useLogout } from './api';

/**
 * Shown in place of the whole app while the server says the signed-in person has to choose a
 * password of their own (an admin set the first one). There is no route out of it but signing
 * out: the server refuses everything else anyway, so a link here would only lead to an error.
 */
export function ForcedPasswordChange({ email }: { email: string }) {
  const logout = useLogout();
  return (
    <main className="flex h-full items-center justify-center p-4">
      <div
        aria-labelledby="forced-title"
        role="region"
        className="w-[400px] max-w-full rounded-xl border border-line bg-raised p-8 shadow-pop"
      >
        <h1
          id="forced-title"
          className="m-0 mb-1 flex items-center gap-2.5 text-[22px] font-semibold"
        >
          <Logo />
          Choose a new password
        </h1>
        <p className="mt-0 mb-5 text-dim">
          {email} is using a password an admin set. Pick one only you know to continue.
        </p>
        {/* The change clears the flag on the session, and the auth gate lets the person in. */}
        <PasswordChangeForm
          onDone={() => {}}
          actions={
            <Button disabled={logout.isPending} onClick={() => logout.mutate()}>
              Sign out
            </Button>
          }
        />
      </div>
    </main>
  );
}
