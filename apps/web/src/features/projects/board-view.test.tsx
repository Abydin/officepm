import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { demoUser, jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { handoffResult, makeTicket, signedIn } from '@/test/fixtures';

// hidden: a modal dialog hides the board from the accessibility tree while it is open.
const column = (name: string) => screen.getByRole('region', { name, hidden: true });

const HANDOFF = 'POST /api/tickets/FOOD-DES-1/handoff';

/**
 * A board whose handoff route really moves the ticket, like the server: an accepted
 * handoff changes what the next GET returns. `handoff` replaces the answer.
 */
function setup(
  tickets: ReturnType<typeof makeTicket>[],
  handoff?: () => Response | Promise<Response>,
) {
  return stubApi({
    ...signedIn,
    'GET /api/tickets': () => jsonResponse(tickets),
    [HANDOFF]:
      handoff ??
      ((init) => {
        const to = JSON.parse(String(init?.body)).to_status as string;
        const result = handoffResult(tickets[0]!, to);
        Object.assign(tickets[0] ?? {}, { status: to });
        return jsonResponse(result);
      }),
  });
}

const handoffCalls = (fetchMock: ReturnType<typeof setup>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/handoff'));

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

  it('counts top-level tickets in the header and reports sub-tickets apart, showing them as cards', async () => {
    setup([
      makeTicket({ title: 'Parent', status: 'Done', progress: { done: 1, total: 2 } }),
      makeTicket({
        id: 2,
        key: 'FOOD-DES-2',
        title: 'Kid one',
        status: 'Done',
        subticket_of: 'FOOD-DES-1',
      }),
      makeTicket({ id: 3, key: 'FOOD-DES-3', title: 'Kid two', subticket_of: 'FOOD-DES-1' }),
      makeTicket({ id: 4, key: 'FOOD-DES-4', title: 'Other', status: 'Review' }),
    ]);
    renderApp('/projects/food/boards/design');
    expect(await screen.findByText('2 tickets · 1 done · 2 sub-tickets')).toBeVisible();
    // The sub-tickets are still cards on the board, marked as such.
    const backlog = column('Backlog');
    expect(within(backlog).getByRole('button', { name: /FOOD-DES-3.*Kid two/ })).toHaveTextContent(
      'sub of FOOD-DES-1',
    );
    expect(within(column('Done')).getByRole('button', { name: /Parent/ })).toHaveTextContent('1/2');
  });

  it('opens the handoff dialog instead of moving, and Cancel leaves the card where it was', async () => {
    const fetchMock = setup([makeTicket()]);
    const user = userEvent.setup();
    renderApp('/projects/food/boards/design');

    const card = await screen.findByRole('button', { name: /FOOD-DES-1/ });
    card.focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');

    const dialog = await screen.findByRole('dialog', { name: /Move FOOD-DES-1/ });
    expect(within(dialog).getByRole('combobox', { name: 'Move to' })).toHaveValue('In Progress');
    // Nothing moved while the question is open.
    expect(within(column('Backlog')).getByText('Logo refresh')).toBeInTheDocument();
    expect(within(column('In Progress')).queryByText('Logo refresh')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(column('Backlog')).getByText('Logo refresh')).toBeInTheDocument();
    expect(handoffCalls(fetchMock)).toEqual([]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('moves the card once the handoff is approved, through the handoff route and not PATCH', async () => {
    const fetchMock = setup([makeTicket()]);
    const user = userEvent.setup();
    renderApp('/projects/food/boards/design');

    const card = await screen.findByRole('button', { name: /FOOD-DES-1/ });
    card.focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    const dialog = await screen.findByRole('dialog', { name: /Move FOOD-DES-1/ });
    await user.click(within(dialog).getByRole('button', { name: 'Approve and move' }));

    await waitFor(() =>
      expect(within(column('In Progress')).getByText('Logo refresh')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const [call] = handoffCalls(fetchMock);
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      decision: 'approve',
      to_status: 'In Progress',
      from_status: 'Backlog',
    });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('keeps the card, and says why in the dialog, when the server refuses the move', async () => {
    const message = 'Waterfall boards are sequential only: move through "Review" first';
    setup([makeTicket()], () => jsonResponse({ error: message }, 409));
    const user = userEvent.setup();
    renderApp('/projects/food/boards/design');

    const card = await screen.findByRole('button', { name: /FOOD-DES-1/ });
    card.focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    const dialog = await screen.findByRole('dialog', { name: /Move FOOD-DES-1/ });
    await user.click(within(dialog).getByRole('button', { name: 'Approve and move' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(within(column('Backlog')).getByText('Logo refresh')).toBeInTheDocument();
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
