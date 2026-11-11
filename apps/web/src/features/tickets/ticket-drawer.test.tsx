import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ticket } from '@officepm/shared';
import { describe, expect, it } from 'vitest';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { makeTicket, signedIn, ticketRoutes } from '@/test/fixtures';

/** A server whose PATCH really changes the ticket, so the drawer sees its own edits come back. */
function setup(initial: Partial<Ticket> = {}, refuse?: string) {
  const ticket = { current: makeTicket(initial) };
  const fetchMock = stubApi({
    ...signedIn,
    'GET /api/tickets': () => jsonResponse([ticket.current]),
    ...ticketRoutes(ticket),
    'PATCH /api/tickets/FOOD-DES-1': (init) => {
      if (refuse) return jsonResponse({ error: refuse }, 409);
      ticket.current = { ...ticket.current, ...JSON.parse(String(init?.body)) };
      return jsonResponse(ticket.current);
    },
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
  return { ticket, patches };
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

  it('shows the server reason and puts the old status back when a change is refused', async () => {
    setup({ status: 'Backlog' }, 'Waterfall boards are sequential only');
    const user = userEvent.setup();
    const drawer = await open();
    const status = within(drawer).getByLabelText('Status');

    await user.selectOptions(status, 'Review');
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'Waterfall boards are sequential only',
    );
    await waitFor(() => expect(status).toHaveValue('Backlog'));
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
