import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { engRoutes, makeTicket } from '@/test/fixtures';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';

const URL_ = '/projects/food/boards/eng/epics';
const pipeline = {
  in_use: true,
  current: 'Engineering',
  completed: false,
  phases: [
    { name: 'Product', department: null, done: 0, total: 0 },
    { name: 'Design', department: 'Design', done: 1, total: 1 },
    { name: 'Engineering', department: 'Engineering', done: 0, total: 2 },
    { name: 'QA', department: null, done: 0, total: 0 },
  ],
  history: [],
};
const epic = makeTicket({
  key: 'FOOD-ENG-1',
  title: 'Group ordering',
  level: 'epic',
  board_slug: 'eng',
  phase: 'Engineering',
});
const kid = (id: number, over: Record<string, unknown>) =>
  makeTicket({ id, key: `FOOD-ENG-${id}`, parent_key: 'FOOD-ENG-1', board_slug: 'eng', ...over });

function setup() {
  const posts: unknown[] = [];
  stubApi(
    engRoutes({
      'GET /api/tickets': [
        epic,
        kid(2, { title: 'Mockups', phase: 'Design', status: 'Done' }),
        kid(3, { title: 'Orders API', phase: 'Engineering', department: 'Backend' }),
        kid(4, { title: 'Order screen', phase: 'Engineering', department: 'Frontend' }),
        kid(5, { title: 'Loose end' }),
      ],
      'GET /api/tickets/FOOD-ENG-1/pipeline': pipeline,
      'POST /api/tickets': (init: RequestInit | undefined) => {
        posts.push(JSON.parse(String(init?.body)));
        return jsonResponse(kid(6, { title: 'x' }), 201);
      },
    }),
  );
  renderApp(URL_);
  return { posts, user: userEvent.setup() };
}

describe('a feature on the Epics screen', () => {
  it('shows the stepper and groups tickets by phase and team lane', async () => {
    setup();
    const card = within(await screen.findByRole('region', { name: /Group ordering/ }));
    const stepper = await card.findByRole('list', { name: 'Pipeline' });
    expect(within(stepper).getByText('Engineering').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );

    const eng = within(card.getByRole('region', { name: 'Engineering tickets' }));
    expect(eng.getByText('Backend')).toBeVisible();
    expect(eng.getByText('Frontend')).toBeVisible();
    expect(eng.getByRole('button', { name: /Orders API/ })).toBeVisible();
    expect(eng.getByRole('button', { name: /Order screen/ })).toBeVisible();
    expect(
      within(card.getByRole('region', { name: 'Design tickets' })).getByText('Mockups'),
    ).toBeVisible();
    expect(
      within(card.getByRole('region', { name: 'Tickets not in a phase' })).getByText('Loose end'),
    ).toBeVisible();
  });

  it('adds a ticket to the feature with its phase and lane preselected', async () => {
    const { posts, user } = setup();
    const form = within(await screen.findByRole('form', { name: 'Add ticket to FOOD-ENG-1' }));
    expect(form.getByLabelText('Phase')).toHaveValue('Engineering');
    await user.type(form.getByLabelText('Add ticket to this feature'), 'Payments API');
    await user.type(form.getByLabelText('Team lane'), 'Backend');
    await user.click(form.getByRole('button', { name: 'Add ticket' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      project_slug: 'food',
      board_slug: 'eng',
      title: 'Payments API',
      type: expect.any(String),
      parent_key: 'FOOD-ENG-1',
      phase: 'Engineering',
      department: 'Backend',
    });
  });

  it('shows no pipeline UI for an epic that never started one', async () => {
    stubApi(
      engRoutes({
        'GET /api/tickets': [makeTicket({ key: 'FOOD-ENG-1', title: 'Plain epic', level: 'epic' })],
      }),
    );
    renderApp(URL_);
    await screen.findByRole('region', { name: /Plain epic/ });
    expect(screen.queryByRole('list', { name: 'Pipeline' })).not.toBeInTheDocument();
    expect(screen.queryByText('Add ticket to this feature')).not.toBeInTheDocument();
  });
});
