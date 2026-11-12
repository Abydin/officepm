import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Board } from '@officepm/shared';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { designBoard, makeTicket } from '@/test/fixtures';
import { jsonResponse, stubApi } from '@/test/helpers';
import { HandoffDialog } from './handoff-dialog';

const people = [
  { id: 1, name: 'Maya Okafor', department: 'Design' },
  { id: 2, name: 'Sam Adeyemi', department: 'Engineering' },
  { id: 3, name: 'Tunde Bakare', department: 'Engineering' },
  { id: 4, name: 'Pat Lee', department: null },
];

const waterfall: Board = {
  ...designBoard,
  flow: 'waterfall',
  statuses: ['Requirements', 'Design', 'Implementation', 'Verification'],
  done_statuses: ['Verification'],
};

const result = (to: string) => ({
  ticket: makeTicket({ status: to }),
  comment: {
    id: 1,
    ticket_key: 'FOOD-DES-1',
    author: 'Maya Okafor',
    body: 'x',
    source: 'handoff',
    created_at: '2026-11-11 10:00:00',
  },
  handoff: {
    id: 'h1',
    decision: 'approve',
    from_status: 'Backlog',
    to_status: to,
    to_user_id: null,
    to_department: null,
  },
});

function setup(
  props: { status?: string; target?: string; board?: Board; routes?: Record<string, unknown> } = {},
) {
  const board = props.board ?? designBoard;
  const ticket = makeTicket({ status: props.status ?? 'In Progress' });
  const onClose = vi.fn();
  const onDone = vi.fn();
  const fetchMock = stubApi({
    'GET /api/people': people,
    'POST /api/tickets/FOOD-DES-1/handoff': () => jsonResponse(result('Review')),
    ...props.routes,
  });
  const client = createQueryClient({ queries: { retry: false } });
  render(
    <QueryClientProvider client={client}>
      <HandoffDialog
        request={{ ticket, board, target: props.target }}
        onClose={onClose}
        onDone={onDone}
      />
    </QueryClientProvider>,
  );
  const posts = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([url, init]) => ({
        url: String(url),
        body: init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body ?? '{}')),
      }));
  return { onClose, onDone, fetchMock, posts, user: userEvent.setup() };
}

const dialog = () => screen.getByRole('dialog', { name: /FOOD-DES-1/ });

describe('HandoffDialog', () => {
  it('names the ticket, shows where it is and defaults to approving into the next status', async () => {
    setup();
    const d = within(dialog());
    expect(d.getByText('Logo refresh')).toBeInTheDocument();
    expect(
      d.getByText('In Progress', { selector: '[data-testid="current-status"]' }),
    ).toBeVisible();
    expect(d.getByRole('radio', { name: /Approve/ })).toBeChecked();
    expect(d.getByRole('combobox', { name: 'Move to' })).toHaveValue('Review');
    expect(d.getByRole('button', { name: 'Approve and move' })).toBeEnabled();
  });

  it('lets approve pick any later status, and nothing earlier', async () => {
    setup({ status: 'Backlog' });
    const options = within(screen.getByRole('combobox', { name: 'Move to' })).getAllByRole(
      'option',
    );
    expect(options.map((o) => o.textContent)).toEqual(['In Progress', 'Review', 'Done']);
  });

  it('starts on reject, with the dragged-back column, when the ticket is sent to an earlier status', async () => {
    setup({ status: 'Review', target: 'Backlog' });
    expect(screen.getByRole('radio', { name: /Reject/ })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Move to' })).toHaveValue('Backlog');
  });

  it('starts on the column the ticket was dropped on when that is a later one', async () => {
    setup({ status: 'Backlog', target: 'Done' });
    expect(screen.getByRole('combobox', { name: 'Move to' })).toHaveValue('Done');
  });

  it('needs a reason to reject: the button stays off until there is one', async () => {
    const { user, posts } = setup({ status: 'Review' });
    await user.click(screen.getByRole('radio', { name: /Reject/ }));
    const confirm = screen.getByRole('button', { name: 'Send back' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Move to' })).toHaveValue('In Progress');
    const options = within(screen.getByRole('combobox', { name: 'Move to' })).getAllByRole(
      'option',
    );
    expect(options.map((o) => o.textContent)).toEqual(['Backlog', 'In Progress']);
    const reason = screen.getByRole('textbox', { name: /Reason/ });
    expect(reason).toBeRequired();
    await user.type(reason, '   ');
    expect(confirm).toBeDisabled();
    await user.type(reason, 'Icons are off brand');
    expect(confirm).toBeEnabled();
    expect(posts()).toEqual([]);
  });

  it('sends the decision, target, person, note and the status it saw, then reports done', async () => {
    const { user, posts, onDone } = setup({ status: 'In Progress' });
    await screen.findByRole('option', { name: 'Sam Adeyemi' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Hand over to' }), '2');
    await user.type(screen.getByRole('textbox', { name: /Note/ }), 'Over to you');
    await user.click(screen.getByRole('button', { name: 'Approve and move' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(posts()).toEqual([
      {
        url: '/api/tickets/FOOD-DES-1/handoff',
        body: {
          decision: 'approve',
          to_status: 'Review',
          from_status: 'In Progress',
          assignee_id: 2,
          note: 'Over to you',
          attachment_ids: [],
        },
      },
    ]);
  });

  it('nudges several people: the primary stays single and the others go as participant_ids', async () => {
    const { user, posts } = setup({ status: 'In Progress' });
    await screen.findByRole('option', { name: 'Sam Adeyemi' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Hand over to' }), '2');
    const also = within(screen.getByRole('group', { name: /Also involve/ }));
    // The person chosen as primary is not offered again.
    expect(also.queryByRole('checkbox', { name: /Sam Adeyemi/ })).toBeNull();
    await user.click(also.getByRole('checkbox', { name: /Tunde Bakare/ }));
    await user.click(also.getByRole('checkbox', { name: /Pat Lee/ }));
    await user.click(screen.getByRole('button', { name: 'Approve and move' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ assignee_id: 2, participant_ids: [3, 4] });
  });

  it('drops a chosen participant who becomes the primary, and sends no list when none is chosen', async () => {
    const { user, posts } = setup({ status: 'In Progress' });
    await screen.findByRole('option', { name: 'Sam Adeyemi' });
    const also = within(screen.getByRole('group', { name: /Also involve/ }));
    await user.click(also.getByRole('checkbox', { name: /Sam Adeyemi/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Hand over to' }), '2');
    await user.click(screen.getByRole('button', { name: 'Approve and move' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body.participant_ids).toBeUndefined();
    expect(posts()[0]!.body.assignee_id).toBe(2);
  });

  it('forgets chosen people who are outside a department picked afterwards', async () => {
    const { user, posts } = setup({ status: 'In Progress' });
    await screen.findByRole('option', { name: /Sam Adeyemi/ });
    const also = within(screen.getByRole('group', { name: /Also involve/ }));
    await user.click(also.getByRole('checkbox', { name: /Maya Okafor/ }));
    await user.click(also.getByRole('checkbox', { name: /Tunde Bakare/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Department' }), 'Engineering');
    await user.click(screen.getByRole('button', { name: 'Approve and move' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body.participant_ids).toEqual([3]);
  });

  it('narrows the people to a chosen department and sends the department', async () => {
    const { user, posts } = setup();
    await screen.findByRole('option', { name: /Sam Adeyemi/ });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Department' }), 'Engineering');
    const names = within(screen.getByRole('combobox', { name: 'Hand over to' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['Anyone in Engineering', 'Sam Adeyemi', 'Tunde Bakare']);
    await user.click(screen.getByRole('button', { name: 'Approve and move' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ department: 'Engineering' });
    expect(posts()[0]!.body.assignee).toBeUndefined();
  });

  it('lists departments from the directory, once each, without the empty ones', async () => {
    setup();
    await screen.findByRole('option', { name: /Sam Adeyemi/ });
    const options = within(screen.getByRole('combobox', { name: 'Department' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Any department', 'Design', 'Engineering']);
  });

  it('explains and falls back to the next phase when a waterfall board will not skip ahead', async () => {
    setup({ status: 'Requirements', target: 'Implementation', board: waterfall });
    const move = screen.getByRole('combobox', { name: 'Move to' });
    expect(move).toHaveValue('Design');
    expect(
      within(move)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Design']);
    expect(screen.getByRole('status')).toHaveTextContent(/sequential only/);
  });

  it('cannot approve from the last status, so it starts on reject', async () => {
    setup({ status: 'Done' });
    expect(screen.getByRole('radio', { name: /Approve/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Reject/ })).toBeChecked();
  });

  it('cancel closes without any request', async () => {
    const { user, onClose, fetchMock } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('escape closes it too', async () => {
    const { user, onClose } = setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and shows the server reason when the move is refused', async () => {
    const { user, onClose, onDone } = setup({
      routes: {
        'POST /api/tickets/FOOD-DES-1/handoff': () =>
          jsonResponse({ error: 'Waterfall boards are sequential only' }, 409),
      },
    });
    await user.click(screen.getByRole('button', { name: 'Approve and move' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('sequential only');
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve and move' })).toBeEnabled();
  });

  describe('attachments', () => {
    const png = (name = 'shot.png') => new File(['x'], name, { type: 'image/png' });

    it('uploads the chosen files to the ticket first, then hands off with their ids', async () => {
      const { user, posts, onDone } = setup({
        routes: {
          'POST /api/tickets/FOOD-DES-1/files': () =>
            jsonResponse(
              {
                id: 'f1',
                ticket_key: 'FOOD-DES-1',
                original_name: 'shot.png',
                size_bytes: 1,
                mime_type: 'image/png',
                uploaded_by: 'Maya',
                created_at: '2026-11-11 10:00:00',
              },
              201,
            ),
        },
      });
      await user.upload(screen.getByLabelText('Add attachments'), png());
      expect(screen.getByRole('list', { name: 'Attachments to send' })).toHaveTextContent(
        'shot.png',
      );
      await user.click(screen.getByRole('button', { name: 'Approve and move' }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(posts().map((p) => p.url)).toEqual([
        '/api/tickets/FOOD-DES-1/files',
        '/api/tickets/FOOD-DES-1/handoff',
      ]);
      expect(posts()[1]!.body.attachment_ids).toEqual(['f1']);
    });

    it('takes a pasted image and lets it be removed before sending', async () => {
      const { user } = setup();
      const note = screen.getByRole('textbox', { name: /Note/ });
      note.focus();
      // jsdom has no DataTransfer, and the handler only reads `.files`.
      note.dispatchEvent(
        Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
          clipboardData: { files: [png('image.png')] },
        }),
      );
      const list = await screen.findByRole('list', { name: 'Attachments to send' });
      expect(within(list).getAllByRole('listitem')).toHaveLength(1);
      expect(list).toHaveTextContent(/pasted-image-1\.png/);
      await user.click(within(list).getByRole('button', { name: /Remove pasted-image-1\.png/ }));
      expect(screen.queryByRole('list', { name: 'Attachments to send' })).not.toBeInTheDocument();
    });

    it('takes files dropped on the drop area', async () => {
      setup();
      const zone = screen.getByTestId('handoff-dropzone');
      zone.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
          dataTransfer: { files: [png('dropped.png')] },
        }),
      );
      expect(await screen.findByRole('list', { name: 'Attachments to send' })).toHaveTextContent(
        'dropped.png',
      );
    });

    it('removes what it uploaded when the handoff then fails, so nothing is left on the ticket', async () => {
      const { user, fetchMock } = setup({
        routes: {
          'POST /api/tickets/FOOD-DES-1/files': () =>
            jsonResponse(
              {
                id: 'f9',
                ticket_key: 'FOOD-DES-1',
                original_name: 'shot.png',
                size_bytes: 1,
                mime_type: 'image/png',
                uploaded_by: 'Maya',
                created_at: '2026-11-11 10:00:00',
              },
              201,
            ),
          'POST /api/tickets/FOOD-DES-1/handoff': () =>
            jsonResponse({ error: 'ticket moved' }, 409),
          'DELETE /api/tickets/FOOD-DES-1/files/f9': () => jsonResponse({ ok: true }),
        },
      });
      await user.upload(screen.getByLabelText('Add attachments'), png());
      await user.click(screen.getByRole('button', { name: 'Approve and move' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('ticket moved');
      const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
      expect(deletes.map(([url]) => String(url))).toEqual(['/api/tickets/FOOD-DES-1/files/f9']);
    });

    it('shows the server message for a refused file, and does not hand off', async () => {
      const { user, posts } = setup({
        routes: {
          'POST /api/tickets/FOOD-DES-1/files': () =>
            jsonResponse({ error: 'file type .exe is not allowed' }, 400),
        },
      });
      await user.upload(screen.getByLabelText('Add attachments'), png('virus.exe'));
      await user.click(screen.getByRole('button', { name: 'Approve and move' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('file type .exe is not allowed');
      expect(posts().filter((p) => p.url.endsWith('/handoff'))).toEqual([]);
    });
  });
});
