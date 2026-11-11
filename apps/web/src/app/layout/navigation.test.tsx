import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { demoUser, renderApp, stubApi } from '@/test/helpers';
import { doc, engRoutes, makeSprint, makeTicket } from '@/test/fixtures';

const base = (extra: Record<string, unknown> = {}) =>
  engRoutes({
    'GET /api/projects/food': {
      slug: 'food',
      name: 'Food',
      description: 'Office food ordering',
      boards: [],
    },
    'GET /api/projects/food/docs': [doc()],
    'GET /api/projects/food/boards/eng/sprints': [
      makeSprint({ id: 's13', name: 'Sprint 13', status: 'completed' }),
      makeSprint({ id: 's14', name: 'Sprint 14', status: 'active' }),
    ],
    'GET /api/tickets': [makeTicket()],
    ...extra,
  });

describe('sidebar', () => {
  it("links to each project's Docs & Files, and shows Admin to admins", async () => {
    stubApi(base());
    renderApp('/overview');
    const nav = within(await screen.findByRole('navigation', { name: 'Projects and boards' }));
    expect(await nav.findByRole('link', { name: 'Docs & Files' })).toHaveAttribute(
      'href',
      '/projects/food/docs',
    );
    expect(nav.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('hides Admin from everyone else', async () => {
    stubApi(base({ 'GET /api/me': { ...demoUser, isAdmin: false } }));
    renderApp('/overview');
    const nav = within(await screen.findByRole('navigation', { name: 'Projects and boards' }));
    await nav.findByRole('link', { name: 'Docs & Files' });
    expect(nav.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });
});

describe('project page', () => {
  it("lists the project's links read-only and points at Docs & Files", async () => {
    stubApi(base());
    renderApp('/projects/food');
    const section = within(await screen.findByRole('region', { name: 'Docs & Links' }));
    expect(await section.findByRole('link', { name: /Ordering API reference/ })).toHaveAttribute(
      'href',
      'https://example.com/docs/ordering-api',
    );
    expect(section.getByRole('link', { name: 'Manage docs and files' })).toHaveAttribute(
      'href',
      '/projects/food/docs',
    );
    expect(screen.queryByText(/not built yet|phase 3c/i)).not.toBeInTheDocument();
  });
});

describe('sprint picker in the top bar', () => {
  it("lists the board's sprints and opens the backlog when one is chosen", async () => {
    stubApi(base());
    const user = userEvent.setup();
    const { router } = renderApp('/projects/food/boards/eng');

    const picker = await screen.findByRole('combobox', { name: 'Sprint' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Sprint 13 · completed', 'Sprint 14 · active']);
    // The active sprint is the one it rests on.
    expect(picker).toHaveValue('s14');
    await user.selectOptions(picker, 's13');
    expect(router.state.location.pathname).toBe('/projects/food/boards/eng/backlog');
  });

  it('is not there on a page that is not a board', async () => {
    stubApi(base());
    renderApp('/overview');
    await screen.findByRole('navigation', { name: 'Projects and boards' });
    expect(screen.queryByRole('combobox', { name: 'Sprint' })).not.toBeInTheDocument();
  });
});
