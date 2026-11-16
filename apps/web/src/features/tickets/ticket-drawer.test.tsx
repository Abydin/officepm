import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_TITLE_LENGTH, type Ticket } from '@officepm/shared';
import { describe, expect, it } from 'vitest';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { designBoard, handoffResult, makeTicket, signedIn, ticketRoutes } from '@/test/fixtures';

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

  it('calls the epic link Epic, so it is not mistaken for sub-ticket ownership', async () => {
    setup({ parent_key: 'FOOD-ENG-1' });
    const drawer = await open();
    expect(within(drawer).getByRole('button', { name: 'Epic: FOOD-ENG-1' })).toBeVisible();
    expect(within(drawer).queryByText('Parent ticket')).toBeNull();
  });

  it('stops the title field at the server cap', async () => {
    setup({ title: 'Logo refresh' });
    const drawer = await open();
    expect(within(drawer).getByLabelText('Title')).toHaveAttribute(
      'maxlength',
      String(MAX_TITLE_LENGTH),
    );
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
    // Priority is set, so its row is on screen without being asked for.
    const { patches } = setup({ priority: 'low' });
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

  describe('the property sidebar', () => {
    it('shows only Status and Assignee on a fresh ticket, and offers the rest', async () => {
      setup();
      const user = userEvent.setup();
      const drawer = await open();
      expect(within(drawer).getByLabelText('Status')).toBeVisible();
      expect(within(drawer).getByRole('button', { name: /^Assignee/ })).toBeVisible();
      for (const name of ['Priority', 'Due date', 'Labels']) {
        expect(within(drawer).queryByLabelText(name)).toBeNull();
      }
      expect(within(drawer).queryByRole('button', { name: /^QA owner/ })).toBeNull();
      expect(within(drawer).queryByRole('button', { name: /^Epic/ })).toBeNull();

      await user.click(within(drawer).getByRole('button', { name: 'Add property' }));
      const options = within(await screen.findByRole('listbox'))
        .getAllByRole('option')
        .map((o) => o.textContent);
      // A kanban board: no Sprint, Points, Appetite, Level or Blocked.
      expect(options).toEqual(['Priority', 'Due date', 'QA owner', 'Epic', 'Labels', 'People']);
    });

    it('reveals an empty property from "Add property", keeps it after you leave it, and saves it', async () => {
      const { patches } = setup();
      const user = userEvent.setup();
      const drawer = await open();

      await user.click(within(drawer).getByRole('button', { name: 'Add property' }));
      await user.click(await screen.findByRole('option', { name: 'Priority' }));
      const priority = within(drawer).getByLabelText('Priority');
      // Focus lands in the new row, and the property is no longer offered.
      await waitFor(() => expect(priority).toHaveFocus());
      await user.tab();
      expect(within(drawer).getByLabelText('Priority')).toHaveValue('');
      await user.click(within(drawer).getByRole('button', { name: 'Add property' }));
      expect(screen.queryByRole('option', { name: 'Priority' })).toBeNull();
      await user.keyboard('{Escape}');

      await user.selectOptions(within(drawer).getByLabelText('Priority'), 'Urgent');
      await waitFor(() => expect(patches()).toEqual([{ priority: 'urgent' }]));
    });

    it('puts the description above the properties in the page, with the title first', async () => {
      setup({ description: 'Make it pop' });
      const drawer = await open();
      const before = (a: HTMLElement, b: HTMLElement) =>
        Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const title = within(drawer).getByLabelText('Title');
      const description = within(drawer).getByLabelText('Description');
      expect(before(title, description)).toBe(true);
      expect(before(description, within(drawer).getByLabelText('Status'))).toBe(true);
      expect(before(description, within(drawer).getByRole('button', { name: /^Assignee/ }))).toBe(
        true,
      );
    });

    it("shows a ticket's filled properties without asking, as plain rows", async () => {
      setup({ priority: 'high', due_date: '2030-01-02', labels: ['ui'], parent_key: 'FOOD-ENG-1' });
      const drawer = await open();
      expect(within(drawer).getByLabelText('Priority')).toHaveValue('high');
      expect(within(drawer).getByLabelText('Due date')).toHaveValue('2030-01-02');
      expect(within(drawer).getByRole('button', { name: 'Remove label ui' })).toBeVisible();
      // The epic is a chip in the header as well as a row.
      expect(
        within(drawer).getByRole('button', { name: 'in FOOD-ENG-1, open epic' }),
      ).toBeVisible();
    });

    it('shows the GitHub group only when there are events', async () => {
      const board = { ...designBoard, has_github: true };
      setup({}, undefined, {
        'GET /api/projects/food/boards/design': board,
        'GET /api/tickets/FOOD-DES-1/github': [],
      });
      const drawer = await open();
      await waitFor(() => expect(within(drawer).getByLabelText('Description')).toBeVisible());
      expect(within(drawer).queryByRole('heading', { name: 'GitHub' })).toBeNull();
    });

    it('lists GitHub events in the sidebar when there are some', async () => {
      const board = { ...designBoard, has_github: true };
      setup({}, undefined, {
        'GET /api/projects/food/boards/design': board,
        'GET /api/tickets/FOOD-DES-1/github': [
          {
            id: 'g1',
            ticket_key: 'FOOD-DES-1',
            kind: 'pr',
            repo: 'acme/web',
            ref: 'feat/logo',
            url: null,
            actor: null,
            environment: null,
            created_at: '2026-10-03 10:00:00',
          },
        ],
      });
      const drawer = await open();
      expect(await within(drawer).findByRole('heading', { name: 'GitHub' })).toBeVisible();
      expect(within(drawer).getByText(/feat\/logo/)).toBeVisible();
    });
  });

  describe('the blocked banner', () => {
    it('is absent unless the ticket is blocked', async () => {
      setup();
      const drawer = await open();
      expect(within(drawer).queryByRole('region', { name: 'Blocked' })).toBeNull();
    });

    it('shows an editable reason above the title when it is', async () => {
      const { patches } = setup({ blocked: true, blocker_reason: 'Waiting on payments' });
      const user = userEvent.setup();
      const drawer = await open();
      const banner = within(drawer).getByRole('region', { name: 'Blocked' });
      const reason = within(banner).getByRole('textbox', { name: /reason/i });
      expect(reason).toHaveValue('Waiting on payments');
      expect(
        banner.compareDocumentPosition(within(drawer).getByLabelText('Title')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      await user.clear(reason);
      await user.type(reason, 'Vendor key expired');
      await user.tab();
      await waitFor(() => expect(patches()).toEqual([{ blocker_reason: 'Vendor key expired' }]));
    });
  });

  describe('the header', () => {
    it('deletes through the more-actions menu, after a confirmation', async () => {
      const { fetchMock } = setup({}, undefined, {
        'DELETE /api/tickets/FOOD-DES-1': { ok: true },
      });
      const user = userEvent.setup();
      const drawer = await open();
      expect(within(drawer).queryByRole('button', { name: /Delete/ })).toBeNull();

      await user.click(within(drawer).getByRole('button', { name: 'More actions' }));
      await user.click(await screen.findByRole('button', { name: 'Delete ticket' }));
      expect(within(drawer).getByText('Delete FOOD-DES-1?')).toBeVisible();
      const deleted = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
      expect(deleted()).toHaveLength(0);

      // Keep it backs out without deleting.
      await user.click(within(drawer).getByRole('button', { name: 'Keep it' }));
      expect(deleted()).toHaveLength(0);

      await user.click(within(drawer).getByRole('button', { name: 'More actions' }));
      await user.click(await screen.findByRole('button', { name: 'Delete ticket' }));
      await user.click(within(drawer).getByRole('button', { name: 'Yes, delete' }));
      await waitFor(() => expect(deleted()).toHaveLength(1));
    });
  });

  describe('keys', () => {
    it('F toggles the full page and the address keeps it', async () => {
      setup();
      const user = userEvent.setup();
      const { router } = renderApp('/projects/food/boards/design?t=FOOD-DES-1');
      const drawer = await screen.findByRole('dialog');
      await within(drawer).findByLabelText('Title');
      expect(within(drawer).getByRole('button', { name: 'Open full page' })).toBeVisible();

      await user.keyboard('f');
      expect(new URLSearchParams(router.state.location.search).get('full')).toBe('1');
      expect(within(drawer).getByRole('button', { name: 'Back to side panel' })).toBeVisible();

      await user.keyboard('f');
      expect(new URLSearchParams(router.state.location.search).has('full')).toBe(false);
      expect(new URLSearchParams(router.state.location.search).get('t')).toBe('FOOD-DES-1');
    });

    it('opens as the full page from ?full=1, and closing drops it from the address', async () => {
      setup();
      const user = userEvent.setup();
      const { router } = renderApp('/projects/food/boards/design?t=FOOD-DES-1&full=1');
      const drawer = await screen.findByRole('dialog');
      expect(
        await within(drawer).findByRole('button', { name: 'Back to side panel' }),
      ).toBeVisible();
      await user.click(within(drawer).getByRole('button', { name: 'Close ticket' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(router.state.location.search).toBe('');
    });

    it('ignores F, P and R while typing in a field', async () => {
      setup();
      const user = userEvent.setup();
      const { router } = renderApp('/projects/food/boards/design?t=FOOD-DES-1');
      const drawer = await screen.findByRole('dialog');
      const comment = await within(drawer).findByLabelText('Add a comment');
      await user.click(comment);
      await user.keyboard('fpr');
      expect(comment).toHaveValue('fpr');
      expect(router.state.location.search).toBe('?t=FOOD-DES-1');
      expect(screen.queryByRole('combobox', { name: 'Find a property' })).toBeNull();
    });

    it('P opens "Add property" with the filter focused, and Escape closes it before the drawer', async () => {
      setup();
      const user = userEvent.setup();
      const drawer = await open();
      drawer.focus();
      await user.keyboard('p');
      const filter = await screen.findByRole('combobox', { name: 'Find a property' });
      expect(filter).toHaveFocus();
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('combobox', { name: 'Find a property' })).toBeNull(),
      );
      expect(screen.getByRole('dialog')).toBeVisible();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('R puts the caret in the comment box', async () => {
      setup();
      const user = userEvent.setup();
      const drawer = await open();
      drawer.focus();
      await user.keyboard('r');
      expect(within(drawer).getByLabelText('Add a comment')).toHaveFocus();
    });
  });

  describe('activity and attachments', () => {
    const comment = (id: number, source: 'user' | 'system' | 'handoff', body: string) => ({
      id,
      ticket_key: 'FOOD-DES-1',
      author: source === 'system' ? 'GitHub' : 'Maya Okafor',
      body,
      source,
      created_at: '2026-10-03 10:00:00',
    });

    it('shows comments, GitHub and handoffs as one stream, and "Comments" hides all but people', async () => {
      setup({}, undefined, {
        'GET /api/tickets/FOOD-DES-1/comments': [
          comment(1, 'user', 'Looks good'),
          comment(2, 'system', 'PR opened'),
          comment(3, 'handoff', 'Moved from Backlog to Review'),
        ],
      });
      const user = userEvent.setup();
      const drawer = await open();
      expect(await within(drawer).findByText('PR opened')).toBeVisible();
      expect(within(drawer).getByText('Moved from Backlog to Review')).toBeVisible();

      await user.click(within(drawer).getByRole('button', { name: 'Comments' }));
      expect(within(drawer).getByText('Looks good')).toBeVisible();
      expect(within(drawer).queryByText('PR opened')).toBeNull();
      expect(within(drawer).queryByText('Moved from Backlog to Review')).toBeNull();

      await user.click(within(drawer).getByRole('button', { name: 'All' }));
      expect(within(drawer).getByText('PR opened')).toBeVisible();
    });

    it("offers no filter when there are only people's comments", async () => {
      setup({}, undefined, {
        'GET /api/tickets/FOOD-DES-1/comments': [comment(1, 'user', 'Looks good')],
      });
      const drawer = await open();
      expect(await within(drawer).findByText('Looks good')).toBeVisible();
      expect(within(drawer).queryByRole('button', { name: 'All' })).toBeNull();
    });

    it('keeps the link form shut until "Link" is pressed', async () => {
      setup();
      const user = userEvent.setup();
      const drawer = await open();
      expect(within(drawer).getByRole('heading', { name: 'Attachments and links' })).toBeVisible();
      expect(within(drawer).queryByLabelText('Link title')).toBeNull();
      await user.click(within(drawer).getByRole('button', { name: 'Link' }));
      expect(within(drawer).getByLabelText('Link title')).toBeVisible();
      expect(within(drawer).getByLabelText('Link URL')).toBeVisible();
    });
  });
});
