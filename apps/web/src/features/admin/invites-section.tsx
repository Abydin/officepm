import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { InviteCreated, InviteListItem } from '@officepm/shared';
import { CopyButton } from '@/components/copy-button';
import { ErrorAlert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { invitesQuery, useCreateInvite, useRevokeInvite } from './api';
import { InlineConfirm } from './inline-confirm';

export const th = 'px-3 py-2 font-medium';
export const td = 'px-3 py-2';
// relative: the screen-reader-only header text is absolutely positioned and must stay inside the scroller.
export const tableBox = 'relative overflow-x-auto rounded-lg border border-line bg-raised';

const day = (stamp: string) => stamp.slice(0, 10);

/** The link an admin just made. It is the only copy: the server keeps a hash and cannot show it again. */
function CreatedLink({ invite, onDismiss }: { invite: InviteCreated; onDismiss: () => void }) {
  return (
    <div
      aria-labelledby="invite-link-title"
      role="group"
      className="mt-4 rounded-md border border-line-strong bg-field p-3"
    >
      <h3 id="invite-link-title" className="m-0 mb-1 text-[13px] font-semibold">
        Invite link for {invite.name}
      </h3>
      <p className="mt-0 mb-2 text-dim">
        Shown once: it cannot be shown again. Send it to {invite.email} yourself, OfficePM sends no
        email. It works until {day(invite.expires_at)} and once.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          readOnly
          aria-label="Invite link"
          value={invite.link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-64 flex-1 font-mono text-xs"
        />
        <CopyButton text={invite.link} name="invite link" />
        <Button size="sm" onClick={onDismiss}>
          Hide link
        </Button>
      </div>
    </div>
  );
}

function InviteRow({ invite }: { invite: InviteListItem }) {
  const revoke = useRevokeInvite();
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-hover">
      <td className={td}>{invite.email}</td>
      <td className={td}>{invite.name}</td>
      <td className={td}>
        {invite.is_admin ? <Badge>Admin</Badge> : <span className="text-dim">Member</span>}
      </td>
      <td className={td}>
        <Badge className={invite.status === 'pending' ? 'text-fg' : ''}>{invite.status}</Badge>
      </td>
      <td className={td}>{day(invite.expires_at)}</td>
      <td className={`${td} text-right`}>
        {invite.status !== 'used' && (
          <InlineConfirm
            action="Revoke"
            name={`the invite for ${invite.email}`}
            confirmLabel="Yes, revoke"
            variant="danger"
            pending={revoke.isPending}
            onConfirm={() => revoke.mutate(invite.id)}
          />
        )}
        {revoke.isError && <ErrorAlert className="mt-2">{errorMessage(revoke.error)}</ErrorAlert>}
      </td>
    </tr>
  );
}

/** Invite staff by link: make one, copy it once, and see which are pending, used or expired. */
export function InviteSection() {
  const invites = useQuery(invitesQuery);
  const create = useCreateInvite();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [created, setCreated] = useState<InviteCreated | null>(null);
  const complete = email.trim() && name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!complete) return;
    create.mutate(
      { email: email.trim(), name: name.trim(), ...(isAdmin ? { is_admin: true } : {}) },
      {
        onSuccess: (invite) => {
          setCreated(invite);
          setEmail('');
          setName('');
          setIsAdmin(false);
        },
      },
    );
  };

  return (
    <Card aria-labelledby="invite-staff" className="mt-6">
      <h2 id="invite-staff" className="m-0 mb-1 text-[15px] font-semibold">
        Invite staff
      </h2>
      <p className="mt-0 mb-3 text-dim">
        Make a one-time link, valid for 7 days. The person opens it and chooses their own password.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="invite-address" className="mb-1 block text-xs text-dim">
            Invitee address
          </label>
          <Input
            id="invite-address"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor="invite-name" className="mb-1 block text-xs text-dim">
            Invitee name
          </label>
          <Input
            id="invite-name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <label className="flex min-h-8 items-center gap-2">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          Invite as admin
        </label>
        <Button type="submit" variant="primary" disabled={!complete || create.isPending}>
          Create invite
        </Button>
      </form>
      {create.isError && <ErrorAlert className="mt-3">{errorMessage(create.error)}</ErrorAlert>}
      {created && <CreatedLink invite={created} onDismiss={() => setCreated(null)} />}

      <h3 className="mt-5 mb-2 text-[13px] font-semibold">Invites</h3>
      {invites.isError && <ErrorAlert>{errorMessage(invites.error)}</ErrorAlert>}
      {invites.isPending && <Skeleton className="h-12" />}
      {invites.data && invites.data.length === 0 && <p className="m-0 text-dim">No invites yet.</p>}
      {invites.data && invites.data.length > 0 && (
        <div className={tableBox}>
          <table aria-label="Invites" className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs text-dim">
                {['Email', 'Name', 'Role', 'Status', 'Expires'].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
                <th scope="col" className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invites.data.map((invite) => (
                <InviteRow key={invite.id} invite={invite} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
