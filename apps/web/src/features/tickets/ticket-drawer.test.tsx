import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ticket } from '@officepm/shared';
import { describe, expect, it } from 'vitest';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { handoffResult, makeTicket, signedIn, ticketRoutes } from '@/test/fixtures';

/** A server whose PATCH really changes the ticket, so the drawer sees its own edits come back. */
function setup(
  initial: Partial<Ticket> = {},
  refuse?: string,
  extra: Record<string, unknown> = {},
) {
  const ticket = { current: makeTicket(initial) };
  const fetchMock = stubApi({
    ...signedIn,
    'GET /api/tickets': () => jsonResponse([ticket.current]),
    ...ticketRoutes(ticket),
    'PATCH /api/tickets/FOOD-DES-1': (init) => {
      ticket.current = { ...ticket.current, ...JSON.parse(String(init?.body)) };
      return jsonResponse(ticket.current);
    },
    'POST /api/tickets/FOOD-DES-1/handoff': (init) => {
      if (refuse) return jsonResponse({ error: refuse }, 409);
      const to = JSON.parse(String(init?.body)).to_status as string;
      const result = handoffResult(ticket.current, to);
      ticket.current = { ...ticket.current, status: to };
      return jsonResponse(result);
    },
    ...extra,
    'POST /api/tickets/FOOD-DES-1/comments': (init) =>
      jsonResponse(
        {
          id: 9,
          ticket_key: 'FOOD-DES-1',
          author: 'Maya Okafor',
          body: JSON.parse(String(init?.body)).body,
          source: 'user',
          created_at: '2026-10-03 10:00:00',
        },
        201,
      ),
  });
  const patches = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
  return { ticket, patches, fetchMock };
}

const open = async () => {
  renderApp('/projects/food/boards/design?t=FOOD-DES-1');
  const drawer = await screen.findByRole('dialog');
  await within(drawer).findByLabelText('Title');
  return drawer;
};

describe('ticket drawer', () => {
  it('opens from ?t=KEY on top of the board and shows the ticket', async () => {
    setup({ title: 'Logo refresh', description: 'Make it pop' });
    const drawer = await open();
    expect(within(drawer).getByLabelText('Title')).toHaveValue('Logo refresh');
    expect(within(drawer).getByLabelText('Description')).toHaveValue('Make it pop');
    // The board is still there behind it.
    expect(screen.getByText('Backlog', { selector: 'h2 span' })).toBeInTheDocument();
  });

  it('saves a new title when you leave the field, and refuses an empty one', async () => {
    const { patches } = setup({ title: 'Logo refresh' });
    const user = userEvent.setup();
    const drawer = await open();
    const title = within(drawer).getByLabelText('Title');

    await user.clear(title);
    await user.type(title, 'Logo refresh v2');
    await user.tab();
    await waitFor(() => expect(patches()).toEqual([{ title: 'Logo refresh v2' }]));

    // The saved field is rebuilt, so look it up again.
    const saved = await within(drawer).findByDisplayValue('Logo refresh v2');
    await user.clear(saved);
    await user.tab();
    expect(patches()).toHaveLength(1);
    await waitFor(() =>
      expect(within(drawer).getByLabelText('Title')).toHaveValue('Logo refresh v2'),
    );
  });

  it('changes the priority from a select', async () => {
    const { patches } = setup();
    const user = userEvent.setup();
    const drawer = await open();
    await user.selectOptions(within(drawer).getByLabelText('Priority'), 'High');
    await waitFor(() => expect(patches()).toEqual([{ priority: 'high' }]));
    expect(within(drawer).getByLabelText('Priority')).toHaveValue('high');
  });

  it('picks an assignee from a searchable list, not a text box', async () => {
    const { patches } = setup();
    const user = userEvent.setup();
    const drawer = await open();

    await user.click(within(drawer).getByRole('button', { name: 'Assignee: Unassigned' }));
    await user.type(screen.getByRole('combobox', { name: /Find a person/ }), 'sam');
    await user.click(await screen.findByRole('option', { name: /Sam Adeyemi/ }));

    await waitFor(() => expect(patches()).toEqual([{ assignee: 'sam@officepm.demo' }]));
    expect(
      await within(drawer).findByRole('button', { name: 'Assignee: Sam Adeyemi' }),
    ).toBeVisible();
  });

  it('adds a label by choosing "use" on a new name, and removes one with its button', async () => {
    const { patches } = setup({ labels: ['ui'] });
    const user = userEvent.setup();
    const drawer = await open();

    await user.click(within(drawer).getByRole('button', { name: 'Add label' }));
    await user.type(screen.getByRole('combobox', { name: /Find a label/ }), 'brand');
    await user.click(await screen.findByRole('option', { name: /Use "brand"/ }));
    await waitFor(() => expect(patches()).toEqual([{ labels: ['ui', 'brand'] }]));

    await user.click(await within(drawer).findByRole('button', { name: 'Remove label ui' }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ labels: ['brand'] }));
  });

  it('opens the handoff dialog when the status is changed, and leaves the status alone until it is confirmed', async () => {
    const { patches } = setup({ status: 'Backlog' });
    const user = userEvent.setup();
    const drawer = await open();
    const status = within(drawer).getByLabelText('Status');

    await user.selectOptions(status, 'Review');
    const dialog = await screen.findByRole('dialog', { name: /Move FOOD-DES-1/ });
    expect(within(dialog).getByRole('combobox', { name: 'Move to' })).toHaveValue('Review');
    expect(status).toHaveValue('Backlog');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(status).toHaveValue('Backlog');
    expect(patches()).toEqual([]);

    await user.selectOptions(status, 'Review');
    await user.click(
      within(await screen.findByRole('dialog', { name: /Move FOOD-DES-1/ })).getByRole('button', {
        name: 'Approve and move',
      }),
    );
    await waitFor(() => expect(status).toHaveValue('Review'));
    expect(patches()).toEqual([]);
  });

  it('shows the server reason in the dialog and keeps the old status when the move is refused', async () => {
    setup({ status: 'Backlog' }, 'Waterfall boards are sequential only');
    const user = userEvent.setup();
    const drawer = await open();
    const status = within(drawer).getByLabelText('Status');

    await user.selectOptions(status, 'Review');
    const dialog = await screen.findByRole('dialog', { name: /Move FOOD-DES-1/ });
    await user.click(within(dialog).getByRole('button', { name: 'Approve and move' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Waterfall boards are sequential only',
    );
    expect(status).toHaveValue('Backlog');
  });

  it('marks the handoffs on a ticket as read when its drawer opens, once', async () => {
    let unread = [
      {
        id: 'h1',
        ticket_key: 'FOOD-DES-1',
        ticket_title: 'Logo refresh',
        decision: 'approve',
        from_status: 'Backlog',
        to_status: 'In Progress',
        from_name: 'Sam Adeyemi',
        note: null,
        reason: null,
        created_at: '2026-10-03 10:00:00',
      },
    ];
    const { fetchMock } = setup({}, undefined, {
      'GET /api/handoffs/unread': () => jsonResponse(unread),
      'POST /api/tickets/FOOD-DES-1/handoffs/read': () => {
        unread = [];
        return jsonResponse({ ok: true });
      },
    });
    await open();
    await waitFor(() => expect(unread).toEqual([]));
    const reads = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/handoffs/read'));
    expect(reads).toHaveLength(1);
  });

  it('posts a comment', async () => {
    setup();
    const user = userEvent.setup();
    const drawer = await open();
    await user.type(within(drawer).getByLabelText('Add a comment'), 'Looks good');
    await user.click(within(drawer).getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(screen.queryByDisplayValue('Looks good')).not.toBeInTheDocument());
  });

  it('closes on Escape and drops ?t= from the address', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderApp('/projects/food/boards/design?t=FOOD-DES-1');
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.search).toBe('');
  });

  it('starts with focus on the dialog, or in the title when opened for editing', async () => {
    setup();
    const drawer = await open();
    expect(drawer).toHaveFocus();
    expect(within(drawer).getByRole('button', { name: 'Close ticket' })).toBeVisible();
  });

  it('shows the error and a way out when the ticket does not exist', async () => {
    stubApi({
      ...signedIn,
      'GET /api/tickets': [],
      'GET /api/tickets/FOOD-DES-9': jsonResponse({ error: 'ticket not found' }, 404),
    });
    renderApp('/projects/food/boards/design?t=FOOD-DES-9');
    expect(await screen.findByRole('alert')).toHaveTextContent('ticket not found');
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible();
  });
});
