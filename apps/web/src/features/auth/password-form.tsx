import { useState, type FormEvent, type ReactNode } from 'react';
import { NEW_PASSWORD_MIN, NewPasswordSchema } from '@officepm/shared';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api';
import { useChangePassword } from './api';

/**
 * The change-password fields and their rules, shared by the screen a person is held on until they
 * choose a password and the dialog anyone can open later. `actions` sits beside the submit button.
 */
export function PasswordChangeForm({
  onDone,
  actions,
  autoFocus = true,
}: {
  onDone: () => void;
  actions?: ReactNode;
  autoFocus?: boolean;
}) {
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const strong = NewPasswordSchema.safeParse(next).success;
  const same = next === confirm;
  const valid = current !== '' && strong && same;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    change.mutate({ current_password: current, new_password: next }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} noValidate>
      {change.isError && <ErrorAlert className="mb-4">{errorMessage(change.error)}</ErrorAlert>}
      <div className="mb-4">
        <Label htmlFor="pw-current">Current password</Label>
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          autoFocus={autoFocus}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="mb-4">
        <Label htmlFor="pw-new">New password</Label>
        <Input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          aria-describedby="pw-new-hint"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p
          id="pw-new-hint"
          className={`mt-1 mb-0 text-xs ${next && !strong ? 'text-err' : 'text-dim'}`}
        >
          At least {NEW_PASSWORD_MIN} characters
        </p>
      </div>
      <div className="mb-4">
        <Label htmlFor="pw-confirm">Confirm new password</Label>
        <Input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {confirm && !same && (
          <p className="mt-1 mb-0 text-xs text-err">The passwords do not match</p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {actions}
        <Button type="submit" variant="primary" disabled={!valid || change.isPending}>
          {change.isPending ? 'Saving...' : 'Change password'}
        </Button>
      </div>
    </form>
  );
}
