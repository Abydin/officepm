import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { signedIn } from '@/test/fixtures';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';

const token = 'A'.repeat(43);
const preview = { email: 'new.person@x.test', name: 'New Person' };
const signedOut = () => jsonResponse(null);

describe('the invite screen', () => {
  it('greets the person by name, and asks for a password twice without any sign-in', async () => {
    stubApi({ [`GET /api/invites/${token}`]: preview, 'GET /api/session': signedOut });
    renderApp(`/invite/${token}`);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Welcome, New Person' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Choose a password for new.person@x.test/)).toBeVisible();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  it('holds back a short password or a mismatch, then creates the account and opens the app', async () => {
    const posts: unknown[] = [];
    let accepted = false;
    stubApi({
      ...signedIn,
      [`GET /api/invites/${token}`]: preview,
      'GET /api/session': () => (accepted ? jsonResponse(demoUser) : signedOut()),
      [`POST /api/invites/${token}/accept`]: (init: RequestInit | undefined) => {
        posts.push(JSON.parse(String(init?.body)));
        accepted = true;
        return jsonResponse(demoUser, 201);
      },
    });
    const user = userEvent.setup();
    const { router } = renderApp(`/invite/${token}`);

    const submit = await screen.findByRole('button', { name: 'Create account' });
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'long-enough-1');
    expect(screen.getByText('The passwords do not match')).toBeVisible();
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Confirm password'), 'long-enough-1');
    await user.click(submit);

    await waitFor(() => expect(posts).toEqual([{ password: 'long-enough-1' }]));
    await waitFor(() => expect(router.state.location.pathname).toBe('/overview'));
  });

  it('says the same thing for any link that does not work', async () => {
    stubApi({
      [`GET /api/invites/${token}`]: () => jsonResponse({ error: 'invite not found' }, 404),
      'GET /api/session': signedOut,
    });
    renderApp(`/invite/${token}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This invite link does not work' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/expired, been used already, or been withdrawn/)).toBeVisible();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('shows the server message when making the account fails', async () => {
    stubApi({
      [`GET /api/invites/${token}`]: preview,
      'GET /api/session': signedOut,
      [`POST /api/invites/${token}/accept`]: () =>
        jsonResponse({ error: 'an account with that email already exists' }, 409),
    });
    const user = userEvent.setup();
    renderApp(`/invite/${token}`);
    await user.type(await screen.findByLabelText('Password'), 'long-enough-1');
    await user.type(screen.getByLabelText('Confirm password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});
