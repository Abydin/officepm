import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';

const emptyDashboard = {
  totals: { open: 0, in_progress: 0, done: 0, done_7d: 0, blocked: 0, overdue: 0 },
  boards: [],
  sprint: null,
  needs_me: [],
  activity: [],
};

describe('login page', () => {
  it('has labelled fields and a submit button, and signs in', async () => {
    let signedIn = false;
    const fetchMock = stubApi({
      'GET /api/me': () =>
        signedIn ? jsonResponse(demoUser) : jsonResponse({ error: 'sign in required' }, 401),
      'POST /api/login': () => {
        signedIn = true;
        return jsonResponse(demoUser);
      },
      'GET /api/projects': [],
      'GET /api/dashboard': emptyDashboard,
    });
    const user = userEvent.setup();
    renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), demoUser.email);
    await user.type(screen.getByLabelText('Password'), 'demo-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    const login = fetchMock.mock.calls.find(([url]) => String(url) === '/api/login');
    expect(JSON.parse(String((login?.[1] as RequestInit).body))).toEqual({
      email: demoUser.email,
      password: 'demo-password',
    });
  });

  it("shows the server's message when the credentials are wrong, and stays on the form", async () => {
    stubApi({
      'GET /api/me': jsonResponse({ error: 'sign in required' }, 401),
      'POST /api/login': jsonResponse({ error: 'invalid email or password' }, 401),
    });
    const user = userEvent.setup();
    renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid email or password');
    expect(screen.getByLabelText('Email')).toHaveValue('nobody@example.com');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('disables the button while the request is in flight', async () => {
    let release: (r: Response) => void = () => {};
    stubApi({
      'GET /api/me': jsonResponse({ error: 'sign in required' }, 401),
      'POST /api/login': () => new Promise<Response>((resolve) => (release = resolve)),
    });
    const user = userEvent.setup();
    renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('button', { name: 'Signing in...' })).toBeDisabled();
    release(jsonResponse({ error: 'invalid email or password' }, 401));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
  });

  it('reports a network failure in plain words', async () => {
    stubApi({
      'GET /api/me': jsonResponse({ error: 'sign in required' }, 401),
      'POST /api/login': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });
});
