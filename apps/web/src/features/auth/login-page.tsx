import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api';
import { useLogin, useSession } from './api';

/** Where to go after signing in: the page the gate bounced from, if it left one. */
function destination(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('/login')
    ? from
    : '/';
}

export function LoginPage() {
  const session = useSession();
  const login = useLogin();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (session.data) return <Navigate to={destination(location.state)} replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <main className="flex h-full items-center justify-center p-4">
      <form
        onSubmit={submit}
        aria-labelledby="login-title"
        className="w-[360px] max-w-full rounded-xl border border-line bg-raised p-8 shadow-pop"
      >
        <h1
          id="login-title"
          className="m-0 mb-1 flex items-center gap-2.5 text-[22px] font-semibold"
        >
          <Logo />
          OfficePM
        </h1>
        <p className="mt-0 mb-5 text-dim">One Node process. One SQLite file.</p>
        {login.isError && <ErrorAlert className="mb-4">{errorMessage(login.error)}</ErrorAlert>}
        <div className="mb-4">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="mb-4">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
