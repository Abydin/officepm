import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { makeTicket, signedIn } from '@/test/fixtures';

const column = (name: string) => screen.getByRole('region', { name });

function setup(
  tickets: ReturnType<typeof makeTicket>[],
  patch?: () => Response | Promise<Response>,
  options: { stallRefetch?: boolean } = {},
) {
  let patched = false;
  return stubApi({
    ...signedIn,
    // With stallRefetch the list never answers once a move has been sent, so only
    // the rollback itself (not a fresh GET) can put the card back.
    'GET /api/tickets': () =>
      options.stallRefetch && patched ? new Promise<Response>(() => {}) : jsonResponse(tickets),
    // Like the real server, an accepted PATCH changes what the next GET returns.
    'PATCH /api/tickets/FOOD-DES-1':
      (patch ? () => ((patched = true), patch()) : undefined) ??
      ((init) => {
        patched = true;
        Object.assign(tickets[0] ?? {}, JSON.parse(String(init?.body)));
        return jsonResponse(tickets[0]);
      }),
  });
}

describe('board view', () => {
  it('shows one column per status with the cards in them', async () => {
    setup([
      makeTicket({
        title: 'Logo refresh',
        priority: 'high',
        assignee: demoUser.email,
        labels: ['brand', 'ui', 'print', 'web'],
        blocked: true,
        blocker_reason: 'Waiting on the vendor',
        due_date: '2020-01-01',
      }),
      makeTicket({ id: 2, key: 'FOOD-DES-2', title: 'Icon set', status: 'Review' }),
    ]);
    renderApp('/projects/food/boards/design');

    const backlog = await screen.findByRole('region', { name: 'Backlog' });
    for (const name of ['Backlog', 'In Progress', 'Review', 'Done']) column(name);
    const card = within(backlog).getByRole('button', { name: /FOOD-DES-1.*Logo refresh/ });
    expect(card).toHaveAccessibleName(/FOOD-DES-1.*Logo refresh.*Maya Okafor/);
    expect(card).toHaveTextContent('Blocked: Waiting on the vendor');
    expect(card).toHaveTextContent('Overdue');
    expect(card).toHaveTextContent('+1');
    expect(within(card).getByRole('img', { name: 'Priority high' })).toBeInTheDocument();
    expect(within(column('Review')).getByText('Icon set')).toBeInTheDocument();
    expect(within(column('In Progress')).getByText(/of 3 max/)).toBeInTheDocument();
  });

  it('moves a card at once, then puts it back and says why when the server refuses', async () => {
    let refuse!: () => void;
    const refused = new Promise<void>((resolve) => (refuse = resolve));
    const message = 'Waterfall boards are sequential only: move through "Review" first';
    setup(
      [makeTicket()],
      async () => {
        await refused;
        return jsonResponse({ error: message }, 409);
      },
      { stallRefetch: true },
    );
    const user = userEvent.setup();
    renderApp('/projects/food/boards/design');

    const card = await screen.findByRole('button', { name: /FOOD-DES-1/ });
    card.focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');

    // Optimistic: it is already in the next column while the request is open.
    await waitFor(() =>
      expect(within(column('In Progress')).getByText('Logo refresh')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    refuse();
    // Rolled back, and the server's own words are on screen.
    await waitFor(() =>
      expect(within(column('Backlog')).getByText('Logo refresh')).toBeInTheDocument(),
    );
    expect(within(column('In Progress')).queryByText('Logo refresh')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).toHaveTextContent('FOOD-DES-1 did not move to In Progress');
  });

  it('keeps the card in the new column when the server accepts the move', async () => {
    let body: unknown;
    const fetchMock = setup([makeTicket()]);
    const user = userEvent.setup();
    renderApp('/projects/food/boards/design');

    const card = await screen.findByRole('button', { name: /FOOD-DES-1/ });
    card.focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(call).toBeDefined();
      body = JSON.parse(String(call?.[1]?.body));
    });
    expect(body).toEqual({ status: 'In Progress' });
    expect(within(column('In Progress')).getByText('Logo refresh')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('filters by text, assignee and label, and says how many are shown', async () => {
    setup([
      makeTicket({ title: 'Logo refresh', assignee: demoUser.email, labels: ['brand'] }),
      makeTicket({
        id: 2,
        key: 'FOOD-DES-2',
        title: 'Icon set',
        assignee: 'sam@officepm.demo',
        labels: ['ui'],
      }),
      makeTicket({ id: 3, key: 'FOOD-DES-3', title: 'Poster', status: 'Review' }),
    ]);
    const user = userEvent.setup();
    renderApp('/projects/food/boards/design');
    await screen.findByText('Logo refresh');

    await user.type(screen.getByLabelText('Text'), 'icon');
    expect(screen.queryByText('Logo refresh')).not.toBeInTheDocument();
    expect(screen.getByText('Icon set')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 tickets shown')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.selectOptions(screen.getByLabelText('Assignee'), 'Me');
    expect(screen.getByText('Logo refresh')).toBeInTheDocument();
    expect(screen.queryByText('Icon set')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Assignee'), 'Unassigned');
    expect(screen.getByText('Poster')).toBeInTheDocument();
    expect(screen.queryByText('Logo refresh')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.selectOptions(screen.getByLabelText('Label'), 'ui');
    expect(screen.getByText('Icon set')).toBeInTheDocument();
    expect(screen.queryByText('Poster')).not.toBeInTheDocument();
  });

  it('refreshes when the event stream announces a change', async () => {
    let tickets = [makeTicket()];
    const sources: Array<{ emit: (name: string) => void }> = [];
    class LiveEventSource {
      listeners = new Map<string, Array<() => void>>();
      constructor() {
        sources.push(this);
      }
      addEventListener(name: string, fn: () => void) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
      }
      close() {}
      emit(name: string) {
        for (const fn of this.listeners.get(name) ?? []) fn();
      }
    }
    stubApi({ ...signedIn, 'GET /api/tickets': () => jsonResponse(tickets) });
    vi.stubGlobal('EventSource', LiveEventSource);
    renderApp('/projects/food/boards/design');
    await screen.findByText('Logo refresh');

    tickets = [makeTicket({ status: 'Done' })];
    sources[0]?.emit('ticket.updated');
    await waitFor(() =>
      expect(within(column('Done')).getByText('Logo refresh')).toBeInTheDocument(),
    );
  });
});
