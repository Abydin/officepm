import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { engBoard, engRoutes, makeRetro, makeSprint, makeTicket } from '@/test/fixtures';

const URL_ = '/projects/food/boards/eng/backlog';
const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body));

const burndown = {
  sprint_id: 's14',
  uses_points: true,
  total_scope: 8,
  points: [
    { date: '2026-10-01', ideal: 8, actual: 8 },
    { date: '2026-10-02', ideal: 4, actual: 5 },
  ],
  insufficient_dates: false,
};

function setup(
  over: {
    sprints?: unknown;
    tickets?: unknown;
    retros?: unknown;
    routes?: Record<string, unknown>;
  } = {},
) {
  return stubApi(
    engRoutes({
      'GET /api/projects/food/boards/eng/sprints': over.sprints ?? [
        makeSprint({ id: 's14', name: 'Sprint 14', status: 'planned' }),
        makeSprint({ id: 's13', name: 'Sprint 13', status: 'completed' }),
      ],
      'GET /api/tickets': over.tickets ?? [
        makeTicket({
          key: 'FOOD-ENG-1',
          title: 'In sprint',
          sprint_id: 's14',
          points: 3,
          status: 'Done',
        }),
        makeTicket({ id: 2, key: 'FOOD-ENG-2', title: 'Loose ticket', points: 5 }),
        makeTicket({ id: 3, key: 'FOOD-ENG-3', title: 'Another loose', points: 2 }),
      ],
      'GET /api/projects/food/boards/eng/retros': over.retros ?? [],
      'GET /api/sprints/s14/burndown': burndown,
      'GET /api/sprints/s13/burndown': { ...burndown, sprint_id: 's13' },
      ...over.routes,
    }),
  );
}

describe('backlog view', () => {
  it('lists sprints with their counts and the unscheduled tickets with their points', async () => {
    setup();
    renderApp(URL_);

    const card = (await screen.findByRole('region', { name: 'Sprint 14' })) as HTMLElement;
    expect(card).toHaveTextContent('planned');
    expect(card).toHaveTextContent('1 ticket');
    expect(card).toHaveTextContent('3 pt');
    expect(card).toHaveTextContent('100%');
    expect(screen.getByRole('heading', { name: 'Unscheduled backlog (2 · 7 pt)' })).toBeVisible();
    expect(screen.getByRole('button', { name: /FOOD-ENG-2/ })).toBeVisible();
  });

  it('creates a sprint with the default end date and shows the server message when refused', async () => {
    const posts: unknown[] = [];
    setup({
      routes: {
        'POST /api/projects/food/boards/eng/sprints': (init: RequestInit | undefined) => {
          posts.push(bodyOf(init));
          return posts.length === 1
            ? jsonResponse({ error: 'name required' }, 400)
            : jsonResponse(makeSprint({ id: 'new', name: 'Sprint 15' }), 201);
        },
      },
    });
    const user = userEvent.setup();
    renderApp(URL_);

    await user.type(await screen.findByLabelText('Sprint name'), 'Sprint 15');
    await user.clear(screen.getByLabelText('Start date'));
    await user.type(screen.getByLabelText('Start date'), '2026-11-02');
    // 14 days after the start, the same default the server applies.
    expect(screen.getByLabelText('End date')).toHaveValue('2026-11-16');
    await user.click(screen.getByRole('button', { name: 'Create sprint' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('name required');
    await user.click(screen.getByRole('button', { name: 'Create sprint' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({
      name: 'Sprint 15',
      kind: 'sprint',
      start_date: '2026-11-02',
      end_date: '2026-11-16',
    });
  });

  it('will not activate a sprint until every Definition of Ready item is ticked', async () => {
    const patches: unknown[] = [];
    setup({
      routes: {
        'PATCH /api/sprints/s14': (init: RequestInit | undefined) => {
          patches.push(bodyOf(init));
          return jsonResponse(makeSprint({ status: 'active' }));
        },
      },
    });
    const user = userEvent.setup();
    renderApp(URL_);

    const card = within(await screen.findByRole('region', { name: 'Sprint 14' }));
    await user.click(card.getByRole('button', { name: 'Activate' }));
    const confirm = card.getByRole('button', { name: 'Confirm activate' });
    expect(confirm).toBeDisabled();

    await user.click(card.getByRole('checkbox', { name: 'Acceptance criteria written' }));
    expect(confirm).toBeDisabled();
    await user.click(card.getByRole('checkbox', { name: 'Estimated by the team' }));
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() => expect(patches).toEqual([{ status: 'active' }]));
  });

  it('shows the 409 when another sprint is already active', async () => {
    setup({
      routes: {
        'PATCH /api/sprints/s14': () =>
          jsonResponse({ error: 'another sprint/cycle is already active on this board' }, 409),
      },
    });
    const user = userEvent.setup();
    renderApp(URL_);

    const card = within(await screen.findByRole('region', { name: 'Sprint 14' }));
    await user.click(card.getByRole('button', { name: 'Activate' }));
    await user.click(card.getByRole('checkbox', { name: 'Acceptance criteria written' }));
    await user.click(card.getByRole('checkbox', { name: 'Estimated by the team' }));
    await user.click(card.getByRole('button', { name: 'Confirm activate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already active');
  });

  it('completes an active sprint and then offers its retro', async () => {
    const sprint = { current: makeSprint({ id: 's14', status: 'active' }) };
    const retros: unknown[] = [];
    setup({
      sprints: undefined,
      routes: {
        'GET /api/projects/food/boards/eng/sprints': () => jsonResponse([sprint.current]),
        'GET /api/projects/food/boards/eng/retros': () => jsonResponse(retros),
        'PATCH /api/sprints/s14': (init: RequestInit | undefined) => {
          expect(bodyOf(init)).toEqual({ status: 'completed' });
          sprint.current = { ...sprint.current, status: 'completed' };
          retros.push(makeRetro({ id: 'r9', sprint_id: 's14', name: 'Sprint 14 Retro' }));
          return jsonResponse(sprint.current);
        },
      },
    });
    const user = userEvent.setup();
    renderApp(URL_);

    const card = within(await screen.findByRole('region', { name: 'Sprint 14' }));
    await user.click(card.getByRole('button', { name: 'Mark completed' }));
    const link = await card.findByRole('link', { name: 'View retro' });
    expect(link).toHaveAttribute('href', '/projects/food/boards/eng/retros/r9');
  });

  it('adds an unscheduled ticket to a sprint, and takes one back out', async () => {
    const patches: Array<[string, unknown]> = [];
    const tickets = [
      makeTicket({ key: 'FOOD-ENG-1', title: 'In sprint', sprint_id: 's14' }),
      makeTicket({ id: 2, key: 'FOOD-ENG-2', title: 'Loose ticket' }),
    ];
    setup({
      tickets,
      routes: {
        'PATCH /api/tickets/FOOD-ENG-2': (init: RequestInit | undefined) => {
          patches.push(['FOOD-ENG-2', bodyOf(init)]);
          return jsonResponse(tickets[1]);
        },
        'PATCH /api/tickets/FOOD-ENG-1': (init: RequestInit | undefined) => {
          patches.push(['FOOD-ENG-1', bodyOf(init)]);
          return jsonResponse(tickets[0]);
        },
      },
    });
    const user = userEvent.setup();
    renderApp(URL_);

    const add = await screen.findByLabelText('Add FOOD-ENG-2 to a sprint');
    // Only planned and active sprints are offered, never a completed one.
    expect(
      within(add)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a sprint', 'Sprint 14']);
    await user.selectOptions(add, 'Sprint 14');
    await waitFor(() => expect(patches).toContainEqual(['FOOD-ENG-2', { sprint_id: 's14' }]));

    await user.selectOptions(screen.getByLabelText('Move FOOD-ENG-1'), 'Back to the backlog');
    await waitFor(() => expect(patches).toContainEqual(['FOOD-ENG-1', { sprint_id: null }]));
  });
});

describe('backlog view on other flows', () => {
  const flowRoutes = (
    flow: 'shapeup' | 'waterfall' | 'scrumban',
    extra: Record<string, unknown> = {},
  ) =>
    engRoutes({
      'GET /api/projects/food/boards/eng': {
        ...engBoard,
        flow,
        points: flow === 'scrumban',
        agile: flow === 'shapeup',
        statuses: ['Requirements', 'Design', 'Implementation'],
        done_statuses: ['Implementation'],
      },
      'GET /api/projects/food/boards/eng/sprints': [],
      'GET /api/tickets': [
        makeTicket({ key: 'FOOD-ENG-1', status: 'Design' }),
        makeTicket({ id: 2, key: 'FOOD-ENG-2', status: 'Design' }),
      ],
      'GET /api/projects/food/boards/eng/retros': [],
      ...extra,
    });

  it('offers a cycle or a cooldown on Shape Up and posts the chosen kind with a 6 week default', async () => {
    const posts: unknown[] = [];
    stubApi(
      flowRoutes('shapeup', {
        'POST /api/projects/food/boards/eng/sprints': (init: RequestInit | undefined) => {
          posts.push(bodyOf(init));
          return jsonResponse(makeSprint({ kind: 'cycle' }), 201);
        },
      }),
    );
    const user = userEvent.setup();
    renderApp(URL_);

    expect(await screen.findByRole('heading', { name: 'Cycles' })).toBeVisible();
    const kind = screen.getByLabelText('Kind');
    expect(
      within(kind)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Cycle (6 weeks)', 'Cooldown (2 weeks)']);
    await user.clear(screen.getByLabelText('Start date'));
    await user.type(screen.getByLabelText('Start date'), '2026-01-01');
    expect(screen.getByLabelText('End date')).toHaveValue('2026-02-12');
    await user.selectOptions(kind, 'cooldown');
    expect(screen.getByLabelText('End date')).toHaveValue('2026-01-15');
    await user.type(screen.getByLabelText('Cycle name'), 'Cool');
    await user.click(screen.getByRole('button', { name: 'Create cooldown' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ kind: 'cooldown', end_date: '2026-01-15' });
  });

  it('shows the phase order with ticket counts on Waterfall, and has no kind choice', async () => {
    stubApi(flowRoutes('waterfall'));
    renderApp(URL_);

    const order = await screen.findByRole('list');
    expect(
      within(order)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1Requirements0 tickets', '2Design2 tickets', '3Implementation0 tickets']);
    expect(screen.getByRole('heading', { name: 'Phases' })).toBeVisible();
    expect(screen.queryByLabelText('Kind')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create phase' })).toBeVisible();
  });

  it('reports the velocity on Scrumban, and says so when there is none yet', async () => {
    stubApi(
      flowRoutes('scrumban', {
        'GET /api/projects/food/boards/eng/velocity': {
          uses_points: true,
          sprints: [{ sprint_id: 'a', name: 'W1', completed_scope: 8 }],
          average_velocity: 8,
        },
      }),
    );
    renderApp(URL_);
    expect(await screen.findByLabelText('Velocity')).toHaveTextContent(
      'Average 8 points completed per sprint, across 1 completed sprint.',
    );
  });
});
