import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { signedIn } from '@/test/fixtures';

const users = (over: Array<Record<string, unknown>> = []) => [
  { id: 1, email: demoUser.email, name: 'Maya Okafor', is_admin: 1, created_at: '' },
  { id: 2, email: 'sam@officepm.demo', name: 'Sam Adeyemi', is_admin: 0, created_at: '' },
  ...over,
];

const routes = (extra: Record<string, unknown> = {}) => ({
  ...signedIn,
  'GET /api/admin/projects': { projects: [] },
  'GET /api/projects': [],
  'GET /api/invites': [],
  ...extra,
});

describe('deactivating and reactivating people', () => {
  it('shows a status for everyone and no button to deactivate yourself', async () => {
    stubApi(
      routes({
        'GET /api/users': users([
          {
            id: 3,
            email: 'old@officepm.demo',
            name: 'Old Hand',
            is_admin: 0,
            created_at: '',
            deactivated_at: '2026-11-01 10:00:00',
          },
          {
            id: 4,
            email: 'new@officepm.demo',
            name: 'New Hire',
            is_admin: 0,
            created_at: '',
            must_change_password: 1,
          },
        ]),
      }),
    );
    renderApp('/admin');
    const table = within(await screen.findByRole('table', { name: 'Users' }));
    expect(table.getByRole('row', { name: /sam@officepm.demo/ })).toHaveTextContent('Active');
    expect(table.getByRole('row', { name: /old@officepm.demo/ })).toHaveTextContent('Deactivated');
    expect(table.getByRole('row', { name: /new@officepm.demo/ })).toHaveTextContent(
      'Must choose a password',
    );
    expect(table.queryByRole('button', { name: 'Deactivate Maya Okafor' })).not.toBeInTheDocument();
    expect(table.getByRole('button', { name: 'Deactivate Sam Adeyemi' })).toBeVisible();
    expect(table.getByRole('button', { name: 'Reactivate Old Hand' })).toBeVisible();
  });

  it('asks first, then deactivates, and shows the new status', async () => {
    const posts: string[] = [];
    let gone = false;
    stubApi(
      routes({
        'GET /api/users': () =>
          jsonResponse(
            users().map((u) =>
              u.id === 2 && gone ? { ...u, deactivated_at: '2026-11-25 10:00:00' } : u,
            ),
          ),
        'POST /api/users/2/deactivate': () => {
          posts.push('deactivate');
          gone = true;
          return jsonResponse({ id: 2, deactivated_at: '2026-11-25 10:00:00' });
        },
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');
    await user.click(await screen.findByRole('button', { name: 'Deactivate Sam Adeyemi' }));
    expect(posts).toEqual([]);
    expect(screen.getByText('Deactivate Sam Adeyemi?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Yes, deactivate' }));
    await waitFor(() => expect(posts).toEqual(['deactivate']));
    const row = await screen.findByRole('row', { name: /sam@officepm.demo/ });
    await waitFor(() => expect(row).toHaveTextContent('Deactivated'));
    expect(within(row).getByRole('button', { name: 'Reactivate Sam Adeyemi' })).toBeVisible();
  });

  it('can be cancelled, and reactivates after a confirm', async () => {
    const posts: string[] = [];
    stubApi(
      routes({
        'GET /api/users': users([
          {
            id: 3,
            email: 'old@officepm.demo',
            name: 'Old Hand',
            is_admin: 0,
            created_at: '',
            deactivated_at: '2026-11-01 10:00:00',
          },
        ]),
        'POST /api/users/3/reactivate': () => {
          posts.push('reactivate');
          return jsonResponse({ id: 3, deactivated_at: null });
        },
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');
    await user.click(await screen.findByRole('button', { name: 'Reactivate Old Hand' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(posts).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Reactivate Old Hand' }));
    await user.click(screen.getByRole('button', { name: 'Yes, reactivate' }));
    await waitFor(() => expect(posts).toEqual(['reactivate']));
  });

  it('shows the server message when the last admin cannot be deactivated', async () => {
    stubApi(
      routes({
        'GET /api/users': users(),
        'POST /api/users/2/deactivate': () =>
          jsonResponse({ error: 'the last active admin cannot be deactivated' }, 409),
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');
    await user.click(await screen.findByRole('button', { name: 'Deactivate Sam Adeyemi' }));
    await user.click(screen.getByRole('button', { name: 'Yes, deactivate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('last active admin');
  });
});
