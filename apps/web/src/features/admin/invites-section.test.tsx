import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { signedIn } from '@/test/fixtures';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';

const link = `http://localhost:3000/#/invite/${'k'.repeat(43)}`;

const invite = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  email: 'pending@x.test',
  name: 'Pending Person',
  is_admin: false,
  status: 'pending',
  created_by: 1,
  created_by_name: 'Maya Okafor',
  created_at: '2026-11-20 10:00:00',
  expires_at: '2026-11-27 10:00:00',
  used_at: null,
  ...over,
});

const routes = (extra: Record<string, unknown> = {}) => ({
  ...signedIn,
  'GET /api/admin/projects': { projects: [] },
  // The pipeline section lists projects; none keeps these tests about invites.
  'GET /api/projects': [],
  'GET /api/invites': [],
  ...extra,
});

describe('invite staff', () => {
  it('creates an invite and shows the link once, with a copy button', async () => {
    const posts: unknown[] = [];
    stubApi(
      routes({
        'POST /api/invites': (init: RequestInit | undefined) => {
          posts.push(JSON.parse(String(init?.body)));
          return jsonResponse(
            {
              id: 'i9',
              email: 'new@x.test',
              name: 'New Person',
              is_admin: true,
              expires_at: '2026-11-30 10:00:00',
              link,
            },
            201,
          );
        },
      }),
    );
    const user = userEvent.setup();
    // userEvent installs its own clipboard on setup; watch that one.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderApp('/admin');

    await user.type(await screen.findByLabelText('Invitee address'), ' new@x.test ');
    await user.type(screen.getByLabelText('Invitee name'), 'New Person');
    await user.click(screen.getByLabelText('Invite as admin'));
    await user.click(screen.getByRole('button', { name: 'Create invite' }));

    await waitFor(() =>
      expect(posts).toEqual([{ email: 'new@x.test', name: 'New Person', is_admin: true }]),
    );
    const group = within(await screen.findByRole('group', { name: 'Invite link for New Person' }));
    expect(group.getByLabelText('Invite link')).toHaveValue(link);
    expect(group.getByText(/Shown once/)).toBeVisible();
    expect(group.getByText(/OfficePM sends no email/)).toBeVisible();
    // The form is empty again, so a second invite is a deliberate act.
    expect(screen.getByLabelText('Invitee address')).toHaveValue('');

    await user.click(group.getByRole('button', { name: 'Copy invite link' }));
    expect(writeText).toHaveBeenCalledWith(link);
    expect(await group.findByText('Copied')).toBeVisible();

    await user.click(group.getByRole('button', { name: 'Hide link' }));
    expect(screen.queryByLabelText('Invite link')).not.toBeInTheDocument();
  });

  it('shows the server message when the email is taken', async () => {
    stubApi(
      routes({
        'POST /api/invites': () =>
          jsonResponse({ error: 'a user with that email already exists' }, 409),
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');
    await user.type(await screen.findByLabelText('Invitee address'), 'sam@officepm.demo');
    await user.type(screen.getByLabelText('Invitee name'), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('lists invites by status, and revokes a pending one after a confirm step', async () => {
    const deletes: string[] = [];
    let list = [
      invite(),
      invite({ id: 'i2', email: 'used@x.test', name: 'Used', status: 'used', used_at: 'x' }),
      invite({ id: 'i3', email: 'old@x.test', name: 'Old', status: 'expired' }),
    ];
    stubApi(
      routes({
        'GET /api/invites': () => jsonResponse(list),
        'DELETE /api/invites/i1': () => {
          deletes.push('i1');
          list = list.filter((i) => i.id !== 'i1');
          return jsonResponse({ ok: true });
        },
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');

    const table = within(await screen.findByRole('table', { name: 'Invites' }));
    expect(table.getByRole('row', { name: /pending@x.test/ })).toHaveTextContent('pending');
    expect(table.getByRole('row', { name: /used@x.test/ })).toHaveTextContent('used');
    expect(table.getByRole('row', { name: /old@x.test/ })).toHaveTextContent('expired');
    // A used invite is a record of an account: no revoke on it.
    expect(
      within(table.getByRole('row', { name: /used@x.test/ })).queryByRole('button'),
    ).not.toBeInTheDocument();

    await user.click(table.getByRole('button', { name: 'Revoke the invite for pending@x.test' }));
    expect(deletes).toEqual([]);
    await user.click(table.getByRole('button', { name: 'Yes, revoke' }));
    await waitFor(() => expect(deletes).toEqual(['i1']));
    await waitFor(() => expect(screen.queryByRole('row', { name: /pending@x.test/ })).toBeNull());
  });

  it('can back out of a revoke', async () => {
    stubApi(routes({ 'GET /api/invites': [invite()] }));
    const user = userEvent.setup();
    renderApp('/admin');
    await user.click(
      await screen.findByRole('button', { name: 'Revoke the invite for pending@x.test' }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Revoke the invite for pending@x.test' }),
    ).toBeInTheDocument();
  });
});
