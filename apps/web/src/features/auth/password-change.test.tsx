import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';

const forced = { ...demoUser, mustChangePassword: true };

describe('the forced password change screen', () => {
  it('replaces the whole app while the session says the password must change', async () => {
    stubApi({ 'GET /api/session': forced });
    renderApp('/projects');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose a new password' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/maya.okafor@officepm.demo is using a password an admin set/),
    ).toBeVisible();
    // No navigation to leave by: just the form and a way to sign out.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('checks the new password in the browser, sends it, and lets the person into the app', async () => {
    const posts: unknown[] = [];
    let changed = false;
    stubApi({
      'GET /api/session': () => jsonResponse(changed ? demoUser : forced),
      'POST /api/me/password': (init: RequestInit | undefined) => {
        posts.push(JSON.parse(String(init?.body)));
        changed = true;
        return jsonResponse({ ok: true });
      },
      'GET /api/projects': [],
    });
    const user = userEvent.setup();
    renderApp('/projects');

    await user.type(await screen.findByLabelText('Current password'), 'first-pass');
    const submit = screen.getByRole('button', { name: 'Change password' });
    await user.type(screen.getByLabelText('New password'), 'short');
    expect(submit).toBeDisabled();
    expect(screen.getByText('At least 8 characters')).toHaveClass('text-err');

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'a-better-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-better-pasz');
    expect(screen.getByText('The passwords do not match')).toBeVisible();
    expect(submit).toBeDisabled();
    expect(posts).toEqual([]);

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'a-better-pass');
    await user.click(submit);

    await waitFor(() =>
      expect(posts).toEqual([{ current_password: 'first-pass', new_password: 'a-better-pass' }]),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByText('Choose a new password')).not.toBeInTheDocument();
  });

  it('shows the server message when the current password is wrong, and keeps the person here', async () => {
    stubApi({
      'GET /api/session': forced,
      'POST /api/me/password': () => jsonResponse({ error: 'current password is incorrect' }, 403),
    });
    const user = userEvent.setup();
    renderApp('/projects');
    await user.type(await screen.findByLabelText('Current password'), 'nope');
    await user.type(screen.getByLabelText('New password'), 'a-better-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-better-pass');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('current password is incorrect');
    expect(screen.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeVisible();
  });

  it('appears when any request is refused with password_change_required', async () => {
    let calls = 0;
    stubApi({
      // The page loaded as a normal session; an admin reset the password while it was open.
      'GET /api/session': () => jsonResponse(++calls === 1 ? demoUser : forced),
      'GET /api/projects': () => jsonResponse({ error: 'password_change_required' }, 403),
    });
    renderApp('/projects');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose a new password' }),
    ).toBeInTheDocument();
  });
});

describe('changing your own password from the top bar', () => {
  it('opens a dialog, saves, and says other devices were signed out', async () => {
    const posts: unknown[] = [];
    stubApi({
      'GET /api/session': demoUser,
      'GET /api/projects': [],
      'GET /api/handoffs/unread': [],
      'POST /api/me/password': (init: RequestInit | undefined) => {
        posts.push(JSON.parse(String(init?.body)));
        return jsonResponse({ ok: true });
      },
    });
    const user = userEvent.setup();
    renderApp('/projects');

    await user.click(await screen.findByRole('button', { name: 'Change password' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Change password' }));
    await user.type(dialog.getByLabelText('Current password'), 'old-password');
    await user.type(dialog.getByLabelText('New password'), 'new-password-1');
    await user.type(dialog.getByLabelText('Confirm new password'), 'new-password-1');
    await user.click(dialog.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(posts).toEqual([{ current_password: 'old-password', new_password: 'new-password-1' }]),
    );
    expect(await screen.findByText(/signed out everywhere else/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
