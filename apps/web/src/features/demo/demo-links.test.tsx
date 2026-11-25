import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { DEMO_LOGIN_HINT, DOCS_URL, SETUP_URL } from './links';

const signedOut = () => jsonResponse(null);

function expectLinks(scope: ReturnType<typeof within>) {
  const docs = scope.getByRole('link', { name: 'Documentation' });
  expect(docs).toHaveAttribute('href', DOCS_URL);
  expect(docs).toHaveAttribute('target', '_blank');
  expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
  const setup = scope.getByRole('link', { name: 'Set up your own' });
  expect(setup).toHaveAttribute('href', SETUP_URL);
  expect(setup).toHaveAttribute('target', '_blank');
  expect(setup).toHaveAttribute('rel', 'noopener noreferrer');
}

describe('demo links', () => {
  it('points at the README and its Docker steps, from one address', () => {
    expect(DOCS_URL).toBe('https://github.com/Abydin/officepm#readme');
    expect(SETUP_URL).toBe('https://github.com/Abydin/officepm#with-docker');
  });

  it('are in the banner in demo mode', async () => {
    stubApi({ 'GET /api/config': { demo: true }, 'GET /api/session': signedOut });
    renderApp('/login');
    const banner = await screen.findByRole('note', { name: 'Public demo' });
    expectLinks(within(banner));
  });

  it('are under the Sign in button in demo mode, with the credentials hint', async () => {
    stubApi({ 'GET /api/config': { demo: true }, 'GET /api/session': signedOut });
    renderApp('/login');
    const button = await screen.findByRole('button', { name: 'Sign in' });
    const hint = await screen.findByText(DEMO_LOGIN_HINT);
    expect(hint).toHaveTextContent('Try it: maya.okafor@officepm.demo / demo-password');
    // Below the button, in the form's card.
    expect(button.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const form = button.closest('form')!;
    expectLinks(within(form));
  });

  it('are in the banner of the signed-in app too', async () => {
    stubApi({
      'GET /api/config': { demo: true },
      'GET /api/session': demoUser,
      'GET /api/projects': [],
    });
    renderApp('/projects');
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    expectLinks(within(screen.getByRole('note', { name: 'Public demo' })));
  });

  it('are absent, with no credentials hint, when it is not the demo', async () => {
    stubApi({ 'GET /api/config': { demo: false }, 'GET /api/session': signedOut });
    renderApp('/login');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Documentation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Set up your own' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Try it:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/demo-password/)).not.toBeInTheDocument();
  });

  it('are absent while the config cannot be read', async () => {
    stubApi({
      'GET /api/config': () => jsonResponse({ error: 'boom' }, 500),
      'GET /api/session': signedOut,
    });
    renderApp('/login');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/Try it:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Documentation' })).not.toBeInTheDocument();
  });
});
