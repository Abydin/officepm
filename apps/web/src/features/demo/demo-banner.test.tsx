import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { DEMO_BANNER_TEXT } from './demo-banner';

const signedOut = () => jsonResponse(null);

describe('public demo banner', () => {
  it('says what the demo is on the login page when the server reports demo mode', async () => {
    stubApi({ 'GET /api/config': { demo: true }, 'GET /api/session': signedOut });
    renderApp('/login');

    const note = await screen.findByRole('note', { name: 'Public demo' });
    expect(note).toHaveTextContent(DEMO_BANNER_TEXT);
    // The login form is still there, not covered or replaced.
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--demo-banner-h')).not.toBe(''),
    );
  });

  it('shows nothing, and reserves no room, when it is not the demo', async () => {
    stubApi({ 'GET /api/config': { demo: false }, 'GET /api/session': signedOut });
    renderApp('/login');

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('note', { name: 'Public demo' })).not.toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--demo-banner-h')).toBe('');
  });

  it('does not get in the way when the config cannot be read', async () => {
    stubApi({
      'GET /api/config': () => jsonResponse({ error: 'boom' }, 500),
      'GET /api/session': () => jsonResponse(demoUser),
      'GET /api/projects': [],
    });
    renderApp('/projects');

    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('note', { name: 'Public demo' })).not.toBeInTheDocument();
  });
});
