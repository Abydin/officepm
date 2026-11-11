import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { PasswordResetSchema, type UserListItem } from '@officepm/shared';
import { EmptyState, ErrorAlert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@/features/auth/user-context';
import { usersQuery } from '@/features/tickets/api';
import { errorMessage } from '@/lib/api';
import { projectsConfigQuery, useCreateUser, useResetPassword } from './api';

const th = 'px-3 py-2 font-medium';
const td = 'px-3 py-2';
const table = 'overflow-x-auto rounded-lg border border-line bg-raised';

function CreateUserForm({ onCreated }: { onCreated: (name: string) => void }) {
  const create = useCreateUser();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const complete = email.trim() && name.trim() && password;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!complete) return;
    create.mutate(
      { email: email.trim(), name: name.trim(), password, is_admin: isAdmin },
      {
        onSuccess: (created) => {
          setEmail('');
          setName('');
          setPassword('');
          setIsAdmin(false);
          onCreated(created.name);
        },
      },
    );
  };

  return (
    <Card aria-labelledby="create-user" className="mt-6">
      <h2 id="create-user" className="m-0 mb-3 text-[15px] font-semibold">
        Create user
      </h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="new-user-email" className="mb-1 block text-xs text-dim">
            Email
          </label>
          <Input
            id="new-user-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor="new-user-name" className="mb-1 block text-xs text-dim">
            Name
          </label>
          <Input
            id="new-user-name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor="new-user-password" className="mb-1 block text-xs text-dim">
            Password
          </label>
          <Input
            id="new-user-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <label className="flex min-h-8 items-center gap-2">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          Admin
        </label>
        <Button type="submit" variant="primary" disabled={!complete || create.isPending}>
          Create user
        </Button>
      </form>
      {create.isError && <ErrorAlert className="mt-3">{errorMessage(create.error)}</ErrorAlert>}
    </Card>
  );
}

function ResetPasswordDialog({
  target,
  onClose,
  onDone,
}: {
  target: UserListItem;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const valid = PasswordResetSchema.safeParse({ password }).success;
  const field = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    reset.mutate({ id: target.id, password }, { onSuccess: () => onDone(target.name) });
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade bg-black/50" />
        <Dialog.Content
          aria-describedby="reset-note"
          onOpenAutoFocus={(event) => {
            // The password box, not the close button that comes first in the tab order.
            event.preventDefault();
            field.current?.focus();
          }}
          className="fixed top-[15vh] left-1/2 z-50 w-[min(420px,calc(100vw-24px))] -translate-x-1/2 animate-pop rounded-xl border border-line-strong bg-raised p-4 shadow-pop focus:outline-none"
        >
          <div className="mb-2 flex items-center">
            <Dialog.Title className="m-0 flex-1 text-base font-semibold">
              Reset password for {target.name}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <p id="reset-note" className="mt-0 mb-3 text-dim">
            {target.email} is signed out everywhere and must use the new password.
          </p>
          <form onSubmit={submit}>
            <label htmlFor="reset-password" className="mb-1 block text-xs text-dim">
              New password
            </label>
            <Input
              ref={field}
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {password && !valid && (
              <p className="mt-1 mb-0 text-xs text-err">At least 6 characters</p>
            )}
            {reset.isError && <ErrorAlert className="mt-3">{errorMessage(reset.error)}</ErrorAlert>}
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!valid || reset.isPending}>
                Reset password
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function BoardsTable() {
  const config = useQuery(projectsConfigQuery);
  return (
    <section aria-labelledby="admin-boards" className="mt-6">
      <h2 id="admin-boards" className="m-0 mb-1 text-[15px] font-semibold">
        Boards
      </h2>
      <p className="mt-0 mb-3 text-dim">
        Read only. Boards are declared in projects.json: edit that file and restart the server to
        change them.
      </p>
      {config.isError && <ErrorAlert>{errorMessage(config.error)}</ErrorAlert>}
      {config.isPending && <Skeleton className="h-24" />}
      {config.data && (
        <>
          <div className={table}>
            <table aria-label="Boards" className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-xs text-dim">
                  {['Project', 'Board', 'Prefix', 'Flow', 'Agile', 'GitHub'].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {config.data.projects.flatMap((p) =>
                  p.boards.map((b) => (
                    <tr
                      key={`${p.slug}/${b.slug}`}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className={td}>{p.name}</td>
                      <td className={td}>{b.name}</td>
                      <td className={`${td} font-mono text-xs`}>{text(b.prefix)}</td>
                      <td className={td}>{text(b.flow)}</td>
                      <td className={td}>{b.agile ? 'yes' : ''}</td>
                      <td className={td}>{b.has_github ? 'yes' : ''}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-dim">projects.json as loaded</summary>
            <pre
              tabIndex={0}
              aria-label="projects.json as loaded"
              className="mt-2 max-h-80 overflow-auto rounded-lg border border-line bg-raised p-3 font-mono text-xs"
            >
              {JSON.stringify(config.data, null, 2)}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}

function AdminContent() {
  const users = useQuery(usersQuery);
  const [resetting, setResetting] = useState<UserListItem | null>(null);
  const [notice, setNotice] = useState('');

  return (
    <>
      <h1 className="m-0 mb-4 text-[22px] font-semibold">Admin</h1>
      <div role="status" className="mb-3 empty:hidden text-ok">
        {notice}
      </div>
      <section aria-labelledby="admin-users">
        <h2 id="admin-users" className="m-0 mb-3 text-[15px] font-semibold">
          Users
        </h2>
        {users.isError && <ErrorAlert>{errorMessage(users.error)}</ErrorAlert>}
        {users.isPending && <Skeleton className="h-24" />}
        {users.data && (
          <div className={table}>
            <table aria-label="Users" className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-xs text-dim">
                  <th scope="col" className={th}>
                    Email
                  </th>
                  <th scope="col" className={th}>
                    Name
                  </th>
                  <th scope="col" className={th}>
                    Role
                  </th>
                  <th scope="col" className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id} className="border-b border-line last:border-b-0 hover:bg-hover">
                    <td className={td}>{u.email}</td>
                    <td className={td}>{u.name}</td>
                    <td className={td}>{u.is_admin ? <Badge>Admin</Badge> : null}</td>
                    <td className={`${td} text-right`}>
                      <Button
                        size="sm"
                        aria-label={`Reset password for ${u.name}`}
                        onClick={() => {
                          setNotice('');
                          setResetting(u);
                        }}
                      >
                        Reset password
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <CreateUserForm onCreated={(name) => setNotice(`Created ${name}.`)} />
      <BoardsTable />
      {resetting && (
        <ResetPasswordDialog
          target={resetting}
          onClose={() => setResetting(null)}
          onDone={(name) => {
            setResetting(null);
            setNotice(`Password reset for ${name}.`);
          }}
        />
      )}
    </>
  );
}

/** Users and the board list: v1's Admin page. The server refuses everyone else, and so does this. */
export function AdminPage() {
  const user = useUser();
  if (!user.isAdmin) {
    return (
      <EmptyState title="Admins only">
        Ask an admin if you need a user created or a password reset.
      </EmptyState>
    );
  }
  return <AdminContent />;
}
