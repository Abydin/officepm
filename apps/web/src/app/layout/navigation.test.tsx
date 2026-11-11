import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { demoUser, renderApp, stubApi } from '@/test/helpers';
import {
  designBoard,
  doc,
  engBoard,
  engRoutes,
  foodProject,
  makeSprint,
  makeTicket,
} from '@/test/fixtures';

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

const northwind = {
  slug: 'northwind',
  name: 'Northwind',
  description: 'Second project',
  boards: [{ ...designBoard, slug: 'product', name: 'Product' }],
};

const twoProjects = (extra: Record<string, unknown> = {}) =>
  base({
    'GET /api/projects': [{ ...foodProject, boards: [designBoard, engBoard] }, northwind],
    'GET /api/projects/nope': new Response(JSON.stringify({ error: 'project not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
    ...extra,
  });

describe('sidebar scope', () => {
  it('shows every project, grouped, on an all-projects view', async () => {
    stubApi(twoProjects());
    renderApp('/overview');
    const nav = within(await screen.findByRole('navigation', { name: 'Projects and boards' }));
    expect(await nav.findByRole('link', { name: 'Northwind' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'Food' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'My Tickets' })).toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'All projects' })).not.toBeInTheDocument();
  });

  it("shows only the open project's navigation, and a way back, inside a project", async () => {
    stubApi(twoProjects());
    renderApp('/projects/food/boards/eng');
    const nav = within(await screen.findByRole('navigation', { name: 'Projects and boards' }));
    expect(await nav.findByRole('link', { name: 'Engineering' })).toHaveAttribute(
      'href',
      '/projects/food/boards/eng',
    );
    expect(nav.getByRole('link', { name: 'Design' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'Docs & Files' })).toHaveAttribute(
      'href',
      '/projects/food/docs',
    );
    expect(nav.queryByRole('link', { name: 'Northwind' })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'Product' })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'My Tickets' })).not.toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'All projects' })).toHaveAttribute('href', '/projects');
  });

  it('marks the open board as the current page', async () => {
    stubApi(twoProjects());
    renderApp('/projects/food/boards/eng');
    const nav = within(await screen.findByRole('navigation', { name: 'Projects and boards' }));
    expect(await nav.findByRole('link', { name: 'Engineering' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('is project-scoped on the project page and on Docs & Files too', async () => {
    stubApi(twoProjects());
    renderApp('/projects/food/docs');
    const nav = within(await screen.findByRole('navigation', { name: 'Projects and boards' }));
    expect(await nav.findByRole('link', { name: 'Engineering' })).toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'Northwind' })).not.toBeInTheDocument();
  });

  it('goes back to the full list through the All projects link', async () => {
    stubApi(twoProjects());
    const user = userEvent.setup();
    const { router } = renderApp('/projects/food/boards/eng');
    const nav = within(await screen.findByRole('navigation', { name: 'Projects and boards' }));
    await user.click(await nav.findByRole('link', { name: 'All projects' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));
    expect(await nav.findByRole('link', { name: 'Northwind' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'My Tickets' })).toBeInTheDocument();
  });

  it('shows the full list on My Tickets and the Projects page', async () => {
    stubApi(twoProjects({ 'GET /api/my-tickets': [] }));
    renderApp('/mine');
    const nav = within(await screen.findByRole('navigation', { name: 'Projects and boards' }));
    expect(await nav.findByRole('link', { name: 'Northwind' })).toBeInTheDocument();
  });

  it('says so when the open project does not exist, and still offers the way back', async () => {
    stubApi(twoProjects());
    renderApp('/projects/nope');
    const nav = within(await screen.findByRole('navigation', { name: 'Projects and boards' }));
    expect(await nav.findByText('Project not found.')).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'All projects' })).toBeInTheDocument();
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
    // The backlog screen loads lazily, and a navigation commits once it has.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/projects/food/boards/eng/backlog'),
    );
  });

  it('is not there on a page that is not a board', async () => {
    stubApi(base());
    renderApp('/overview');
    await screen.findByRole('navigation', { name: 'Projects and boards' });
    expect(screen.queryByRole('combobox', { name: 'Sprint' })).not.toBeInTheDocument();
  });
});
