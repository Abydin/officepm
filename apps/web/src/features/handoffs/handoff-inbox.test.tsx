import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { makeTicket, signedIn, ticketRoutes } from '@/test/fixtures';

const notice = (over: Record<string, unknown> = {}) => ({
  id: 'h1',
  ticket_key: 'FOOD-DES-1',
  ticket_title: 'Logo refresh',
  decision: 'approve',
  from_status: 'In Progress',
  to_status: 'Review',
  from_name: 'Sam Adeyemi',
  note: 'Please check the spacing',
  reason: null,
  created_at: '2026-11-11 10:00:00',
  ...over,
});

function setup(initial = [notice()], extra: Record<string, unknown> = {}) {
  let unread = initial;
  const ticket = { current: makeTicket({ status: 'Review' }) };
  const fetchMock = stubApi({
    ...signedIn,
    'GET /api/my-tickets': [],
    'GET /api/tickets': [ticket.current],
    ...ticketRoutes(ticket),
    'GET /api/handoffs/unread': () => jsonResponse(unread),
    'POST /api/tickets/FOOD-DES-1/handoffs/read': () => {
      unread = [];
      return jsonResponse({ ok: true });
    },
    ...extra,
  });
  return {
    fetchMock,
    setUnread: (next: typeof initial) => {
      unread = next;
    },
  };
}

// The page's top bar is the first banner; the board and drawer headers are banners too.
const topbar = () => screen.getAllByRole('banner')[0]!;

describe('handoffs addressed to me', () => {
  it('lists what was handed over on My Tickets, with who, where and the note', async () => {
    setup();
    renderApp('/mine');
    const inbox = await screen.findByRole('region', { name: 'Handed to you' });
    const item = within(inbox).getByRole('listitem');
    expect(item).toHaveTextContent('Sam Adeyemi');
    expect(item).toHaveTextContent('FOOD-DES-1');
    expect(item).toHaveTextContent('Logo refresh');
    expect(item).toHaveTextContent('In Progress');
    expect(item).toHaveTextContent('Review');
    expect(item).toHaveTextContent('Please check the spacing');
  });

  it('shows the reason, not a note, for a ticket sent back', async () => {
    setup([notice({ decision: 'reject', note: null, reason: 'Icons are off brand' })]);
    renderApp('/mine');
    const item = within(await screen.findByRole('region', { name: 'Handed to you' })).getByRole(
      'listitem',
    );
    expect(item).toHaveTextContent('sent back');
    expect(item).toHaveTextContent('Icons are off brand');
  });

  it('has nothing to show, and no region, when there is nothing unread', async () => {
    setup([]);
    renderApp('/mine');
    await screen.findByText('Nothing assigned to you');
    expect(screen.queryByRole('region', { name: 'Handed to you' })).not.toBeInTheDocument();
  });

  it('opens the ticket in the drawer, which reads it', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    const { router } = renderApp('/mine');
    const inbox = await screen.findByRole('region', { name: 'Handed to you' });
    await user.click(within(inbox).getByRole('button', { name: /Open FOOD-DES-1/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?t=FOOD-DES-1'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/handoffs/read')),
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Handed to you' })).not.toBeInTheDocument(),
    );
  });

  it('can be marked read without opening the ticket', async () => {
    setup();
    const user = userEvent.setup();
    renderApp('/mine');
    const inbox = await screen.findByRole('region', { name: 'Handed to you' });
    await user.click(within(inbox).getByRole('button', { name: /Mark read FOOD-DES-1/ }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Handed to you' })).not.toBeInTheDocument(),
    );
  });

  it('counts them on the My Tickets link in the sidebar and on a link in the top bar', async () => {
    setup([notice(), notice({ id: 'h2', ticket_key: 'FOOD-DES-2' })]);
    renderApp('/overview');
    const nav = await screen.findByRole('navigation', { name: 'Projects and boards' });
    expect(await within(nav).findByRole('link', { name: /My Tickets.*2 unread/ })).toHaveAttribute(
      'href',
      '/mine',
    );
    const bar = topbar();
    expect(within(bar).getByRole('link', { name: '2 unread handoffs' })).toHaveAttribute(
      'href',
      '/mine',
    );
  });

  it('shows no count when there is nothing unread', async () => {
    setup([]);
    renderApp('/overview');
    const nav = await screen.findByRole('navigation', { name: 'Projects and boards' });
    expect(within(nav).getByRole('link', { name: 'My Tickets' })).toBeInTheDocument();
    expect(within(topbar()).queryByRole('link', { name: /unread/ })).toBeNull();
  });

  it('shows a new handoff as soon as the event stream announces it', async () => {
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
    const { setUnread } = setup([]);
    vi.stubGlobal('EventSource', LiveEventSource);
    renderApp('/overview');
    await screen.findByRole('navigation', { name: 'Projects and boards' });
    expect(within(topbar()).queryByRole('link', { name: /unread/ })).toBeNull();

    setUnread([notice()]);
    sources[0]?.emit('handoff.created');
    expect(await within(topbar()).findByRole('link', { name: '1 unread handoff' })).toBeVisible();
  });
});
