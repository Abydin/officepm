import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';

const unauthenticated = () => jsonResponse({ error: 'sign in required' }, 401);

describe('auth gate', () => {
  it('shows a loading state while the session is being checked', async () => {
    stubApi({ 'GET /api/me': () => new Promise<Response>(() => {}) });
    renderApp('/projects');
    expect(await screen.findByRole('status')).toHaveTextContent('Loading OfficePM');
  });

  it('sends an anonymous visitor to the login page', async () => {
    stubApi({ 'GET /api/me': unauthenticated });
    const { router } = renderApp('/projects');

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ from: '/projects' });
  });

  it('returns the person to the page they were headed for after signing in', async () => {
    let signedIn = false;
    stubApi({
      'GET /api/me': () => (signedIn ? jsonResponse(demoUser) : unauthenticated()),
      'POST /api/login': () => {
        signedIn = true;
        return jsonResponse(demoUser);
      },
      'GET /api/projects': [],
    });
    const user = userEvent.setup();
    const { router } = renderApp('/projects');

    await user.type(await screen.findByLabelText('Email'), demoUser.email);
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/projects');
  });

  it('renders the page for a signed-in user and redirects /login away', async () => {
    stubApi({
      'GET /api/me': jsonResponse(demoUser),
      'GET /api/projects': [],
    });
    const { router } = renderApp('/login');

    // /login has nothing to offer a signed-in person: it goes to / and on to the overview.
    await waitFor(() => expect(router.state.location.pathname).toBe('/overview'));
  });

  it('says so, and offers a retry, when the session check itself fails', async () => {
    let calls = 0;
    stubApi({
      'GET /api/me': () => {
        calls += 1;
        return calls === 1 ? jsonResponse({ error: 'boom' }, 500) : jsonResponse(demoUser);
      },
      'GET /api/projects': [],
    });
    const user = userEvent.setup();
    renderApp('/projects');

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
  });

  it('drops the session and shows the login page when any request answers 401', async () => {
    stubApi({
      'GET /api/me': jsonResponse(demoUser),
      'GET /api/projects': unauthenticated,
    });
    const { router } = renderApp('/projects');

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});
