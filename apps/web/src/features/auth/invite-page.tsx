import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useParams } from 'react-router';
import { NEW_PASSWORD_MIN, NewPasswordSchema } from '@officepm/shared';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, errorMessage } from '@/lib/api';
import { inviteQuery, useAcceptInvite } from './api';

const card = 'w-[400px] max-w-full rounded-xl border border-line bg-raised p-8 shadow-pop';

/**
 * The screen an invite link opens (#/invite/<token>): set a password, and the account is made and
 * signed in. It is public. Every bad link, whether unknown, expired, used or revoked, reads the
 * same, because the server does not say which.
 */
export function InvitePage() {
  const { token = '' } = useParams();
  const preview = useQuery(inviteQuery(token));
  const accept = useAcceptInvite(token);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  if (accept.isSuccess) return <Navigate to="/" replace />;

  if (preview.isPending) {
    return (
      <main className="flex h-full items-center justify-center p-4">
        <p role="status" className="text-dim">
          Checking your invite...
        </p>
      </main>
    );
  }
  if (preview.isError) {
    const notFound = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <main className="flex h-full items-center justify-center p-4">
        <div role="region" aria-labelledby="invite-bad" className={card}>
          <h1 id="invite-bad" className="m-0 mb-2 text-[22px] font-semibold">
            This invite link does not work
          </h1>
          <p className="m-0 text-dim">
            {notFound
              ? 'It may have expired, been used already, or been withdrawn. Ask an admin for a new one.'
              : errorMessage(preview.error)}
          </p>
        </div>
      </main>
    );
  }

  const strong = NewPasswordSchema.safeParse(password).success;
  const same = password === confirm;
  const valid = strong && same;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) accept.mutate({ password });
  };

  return (
    <main className="flex h-full items-center justify-center p-4">
      <form onSubmit={submit} noValidate aria-labelledby="invite-title" className={card}>
        <h1
          id="invite-title"
          className="m-0 mb-1 flex items-center gap-2.5 text-[22px] font-semibold"
        >
          <Logo />
          Welcome, {preview.data.name}
        </h1>
        <p className="mt-0 mb-5 text-dim">
          Choose a password for {preview.data.email} to finish setting up your account.
        </p>
        {accept.isError && <ErrorAlert className="mb-4">{errorMessage(accept.error)}</ErrorAlert>}
        <div className="mb-4">
          <Label htmlFor="invite-password">Password</Label>
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            aria-describedby="invite-password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p
            id="invite-password-hint"
            className={`mt-1 mb-0 text-xs ${password && !strong ? 'text-err' : 'text-dim'}`}
          >
            At least {NEW_PASSWORD_MIN} characters
          </p>
        </div>
        <div className="mb-4">
          <Label htmlFor="invite-confirm">Confirm password</Label>
          <Input
            id="invite-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {confirm && !same && (
            <p className="mt-1 mb-0 text-xs text-err">The passwords do not match</p>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={!valid || accept.isPending}
        >
          {accept.isPending ? 'Creating your account...' : 'Create account'}
        </Button>
      </form>
    </main>
  );
}
