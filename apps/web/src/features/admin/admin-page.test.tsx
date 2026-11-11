import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { signedIn } from '@/test/fixtures';

const config = {
  projects: [
    {
      slug: 'food',
      name: 'Food',
      description: 'Office food ordering',
      boards: [
        {
          slug: 'eng',
          name: 'Engineering',
          prefix: 'FOOD-ENG',
          flow: 'scrum',
          agile: true,
          has_github: true,
        },
      ],
    },
  ],
};

const routes = (extra: Record<string, unknown> = {}) => ({
  ...signedIn,
  'GET /api/admin/projects': config,
  ...extra,
});

describe('admin page', () => {
  it('lists users with their admin flag, and the boards from projects.json', async () => {
    stubApi(routes());
    renderApp('/admin');

    const users = within(await screen.findByRole('table', { name: 'Users' }));
    const maya = within(users.getByRole('row', { name: /maya.okafor@officepm.demo/ }));
    expect(maya.getByText('Admin')).toBeVisible();
    const sam = within(users.getByRole('row', { name: /sam@officepm.demo/ }));
    expect(sam.queryByText('Admin')).not.toBeInTheDocument();

    const boards = within(await screen.findByRole('table', { name: 'Boards' }));
    expect(boards.getByText('FOOD-ENG')).toBeVisible();
    expect(boards.getByText('scrum')).toBeVisible();
  });

  it('creates a user, with the admin flag when ticked', async () => {
    const posts: unknown[] = [];
    stubApi(
      routes({
        'POST /api/users': (init: RequestInit | undefined) => {
          posts.push(JSON.parse(String(init?.body)));
          return jsonResponse(
            { id: 9, email: 'new@x.demo', name: 'New Person', is_admin: true },
            201,
          );
        },
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');

    await user.type(await screen.findByLabelText('Email'), 'new@x.demo');
    await user.type(screen.getByLabelText('Name'), 'New Person');
    await user.type(screen.getByLabelText('Password'), 'secret1');
    await user.click(screen.getByLabelText('Admin'));
    await user.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() =>
      expect(posts).toEqual([
        { email: 'new@x.demo', name: 'New Person', password: 'secret1', is_admin: true },
      ]),
    );
    // The form empties so a second user cannot be created by accident.
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('shows the server message when the email is taken', async () => {
    stubApi(
      routes({
        'POST /api/users': () =>
          jsonResponse({ error: 'a user with that email already exists' }, 409),
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');
    await user.type(await screen.findByLabelText('Email'), 'sam@officepm.demo');
    await user.type(screen.getByLabelText('Name'), 'Sam');
    await user.type(screen.getByLabelText('Password'), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Create user' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('resets a password in a dialog, refusing one under six characters before it asks the server', async () => {
    const patches: unknown[] = [];
    stubApi(
      routes({
        'PATCH /api/users/2/password': (init: RequestInit | undefined) => {
          patches.push(JSON.parse(String(init?.body)));
          return jsonResponse({ ok: true });
        },
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');

    await user.click(await screen.findByRole('button', { name: 'Reset password for Sam Adeyemi' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Reset password for Sam Adeyemi' }),
    );
    const field = dialog.getByLabelText('New password');
    await user.type(field, '12345');
    expect(dialog.getByRole('button', { name: 'Reset password' })).toBeDisabled();
    expect(dialog.getByText('At least 6 characters')).toBeVisible();
    expect(patches).toEqual([]);

    await user.type(field, '6');
    await user.click(dialog.getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(patches).toEqual([{ password: '123456' }]));
    expect(await screen.findByRole('status')).toHaveTextContent('Password reset for Sam Adeyemi');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("shows each person's department and saves an edited one, or clears it", async () => {
    const patches: Array<{ url: string; body: unknown }> = [];
    const users = [
      {
        id: 1,
        email: demoUser.email,
        name: 'Maya Okafor',
        is_admin: 1,
        created_at: '',
        department: 'Design',
      },
      {
        id: 2,
        email: 'sam@officepm.demo',
        name: 'Sam Adeyemi',
        is_admin: 0,
        created_at: '',
        department: null,
      },
    ];
    stubApi(
      routes({
        'GET /api/users': users,
        'PATCH /api/users/2/department': (init: RequestInit | undefined) => {
          patches.push({ url: '2', body: JSON.parse(String(init?.body)) });
          return jsonResponse({ id: 2, department: 'Engineering' });
        },
        'PATCH /api/users/1/department': (init: RequestInit | undefined) => {
          patches.push({ url: '1', body: JSON.parse(String(init?.body)) });
          return jsonResponse({ id: 1, department: null });
        },
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');

    const maya = await screen.findByLabelText('Department for Maya Okafor');
    expect(maya).toHaveValue('Design');
    const sam = screen.getByLabelText('Department for Sam Adeyemi');
    expect(sam).toHaveValue('');

    await user.type(sam, '  Engineering ');
    await user.tab();
    await waitFor(() =>
      expect(patches).toEqual([{ url: '2', body: { department: 'Engineering' } }]),
    );

    await user.clear(screen.getByLabelText('Department for Maya Okafor'));
    await user.tab();
    await waitFor(() => expect(patches.at(-1)).toEqual({ url: '1', body: { department: null } }));
  });

  it('shows the server message and puts the old department back when a change is refused', async () => {
    stubApi(
      routes({
        'GET /api/users': [
          {
            id: 2,
            email: 'sam@officepm.demo',
            name: 'Sam Adeyemi',
            is_admin: 0,
            created_at: '',
            department: 'Design',
          },
        ],
        'PATCH /api/users/2/department': jsonResponse(
          { error: 'department must be one short line' },
          400,
        ),
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');
    const field = await screen.findByLabelText('Department for Sam Adeyemi');
    await user.type(field, ' and more');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('department must be one short line');
    await waitFor(() =>
      expect(screen.getByLabelText('Department for Sam Adeyemi')).toHaveValue('Design'),
    );
  });

  it('creates a user with a department when one is typed', async () => {
    const posts: unknown[] = [];
    stubApi(
      routes({
        'POST /api/users': (init: RequestInit | undefined) => {
          posts.push(JSON.parse(String(init?.body)));
          return jsonResponse(
            { id: 9, email: 'new@x.demo', name: 'New Person', is_admin: false },
            201,
          );
        },
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');
    await screen.findByRole('table', { name: 'Users' });
    await user.type(screen.getByLabelText('Email'), 'new@x.demo');
    await user.type(screen.getByLabelText('Name', { exact: true }), 'New Person');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'secret-pass');
    await user.type(screen.getByLabelText('Department (optional)'), 'Design');
    await user.click(screen.getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ email: 'new@x.demo', department: 'Design' });
  });

  it('does not show the admin page to someone who is not an admin, or ask for its data', async () => {
    const fetchMock = stubApi({
      ...routes(),
      'GET /api/me': { ...demoUser, isAdmin: false },
    });
    renderApp('/admin');

    expect(await screen.findByText('Admins only')).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Users' })).not.toBeInTheDocument();
    const asked = fetchMock.mock.calls.map(([url]) => String(url));
    expect(asked).not.toContain('/api/users');
    expect(asked).not.toContain('/api/admin/projects');
    vi.restoreAllMocks();
  });
});
