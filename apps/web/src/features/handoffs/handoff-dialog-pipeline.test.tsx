import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EpicPipeline } from '@officepm/shared';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { engBoard, makeTicket } from '@/test/fixtures';
import { jsonResponse, stubApi } from '@/test/helpers';
import { HandoffDialog } from './handoff-dialog';

const people = [
  { id: 1, name: 'Maya Okafor', department: 'Design' },
  { id: 2, name: 'Sam Adeyemi', department: 'Engineering' },
  { id: 3, name: 'Pat Lee', department: null },
];

const phase = (name: string, department: string | null, done = 0, total = 0) => ({
  name,
  department,
  done,
  total,
});

const pipelineAt = (current: string, over: Partial<EpicPipeline> = {}): EpicPipeline => ({
  in_use: true,
  current,
  completed: false,
  phases: [
    phase('Product', null),
    phase('Design', 'Design'),
    phase('Engineering', 'Engineering'),
    phase('Release', null),
  ],
  history: [],
  ...over,
});

function setup(pipeline: EpicPipeline, phaseName = pipeline.current ?? 'Product') {
  const epic = makeTicket({
    key: 'FOOD-ENG-1',
    board_slug: 'eng',
    level: 'epic',
    status: 'Backlog',
    phase: phaseName,
  });
  const fetchMock = stubApi({
    'GET /api/people': people,
    'GET /api/tickets/FOOD-ENG-1/pipeline': pipeline,
    'POST /api/tickets/FOOD-ENG-1/handoff': () =>
      jsonResponse({
        ticket: epic,
        comment: {
          id: 1,
          ticket_key: 'FOOD-ENG-1',
          author: 'x',
          body: 'x',
          source: 'handoff',
          created_at: '2026-11-11 10:00:00',
        },
        handoff: {
          id: 'h',
          decision: 'approve',
          from_status: phaseName,
          to_status: 'Design',
          to_user_id: null,
          to_department: null,
        },
      }),
  });
  render(
    <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
      <HandoffDialog
        request={{ ticket: epic, board: engBoard }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const posts = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body ?? '{}')));
  return { posts, user: userEvent.setup() };
}

describe('the handoff dialog for a feature on a pipeline', () => {
  it('moves between phases, not statuses, and sends to_phase and from_phase', async () => {
    const { posts, user } = setup(pipelineAt('Product'));
    expect(await screen.findByTestId('current-status')).toHaveTextContent('Product');
    expect(screen.getByTestId('next-status')).toHaveTextContent('Design');
    const options = within_select('Move to');
    expect(options).toEqual(['Design', 'Engineering', 'Release']);
    await user.click(screen.getByRole('button', { name: 'Approve and move' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({
      decision: 'approve',
      from_phase: 'Product',
      to_phase: 'Design',
    });
    expect(posts()[0]).not.toHaveProperty('to_status');
    expect(posts()[0]).not.toHaveProperty('from_status');
  });

  it('needs a reason to send a feature back to an earlier phase', async () => {
    const { posts, user } = setup(pipelineAt('Engineering'));
    await screen.findByTestId('current-status');
    await user.click(screen.getByRole('radio', { name: /Reject/ }));
    expect(screen.getByTestId('next-status')).toHaveTextContent('Design');
    expect(within_select('Move to')).toEqual(['Product', 'Design']);
    const send = screen.getByRole('button', { name: 'Send back' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Reason (required)'), 'Design changed');
    await user.click(send);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({
      decision: 'reject',
      from_phase: 'Engineering',
      to_phase: 'Design',
      reason: 'Design changed',
    });
  });

  it('suggests the next phase department for the hand-over until the person picks one', async () => {
    const { user } = setup(pipelineAt('Product'));
    await screen.findByTestId('current-status');
    // Design is the next phase and its department is Design.
    await waitFor(() => expect(screen.getByLabelText('Department')).toHaveValue('Design'));
    expect(within_select('Hand over to')).toEqual(['Anyone in Design', 'Maya Okafor']);
    await user.selectOptions(screen.getByLabelText('Move to'), 'Engineering');
    expect(screen.getByLabelText('Department')).toHaveValue('Engineering');
    await user.selectOptions(screen.getByLabelText('Department'), '');
    await user.selectOptions(screen.getByLabelText('Move to'), 'Release');
    expect(screen.getByLabelText('Department')).toHaveValue('');
  });

  it('warns when tickets tagged with the phase are open, and needs Move anyway', async () => {
    const { posts, user } = setup(
      pipelineAt('Engineering', {
        phases: [
          phase('Product', null),
          phase('Design', 'Design'),
          phase('Engineering', 'Engineering', 1, 3),
          phase('Release', null),
        ],
      }),
    );
    const group = await screen.findByRole('group', { name: 'Open tickets in this phase' });
    expect(group).toHaveTextContent('2 of 3 tickets are still open in Engineering.');
    const send = screen.getByRole('button', { name: 'Approve and move' });
    expect(send).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Move anyway' }));
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ move_anyway: true, to_phase: 'Release' });
  });

  it('does not warn when sending back, and not when everything is done', async () => {
    const open = pipelineAt('Engineering', {
      phases: [
        phase('Product', null),
        phase('Design', 'Design'),
        phase('Engineering', 'Engineering', 1, 3),
        phase('Release', null),
      ],
    });
    const { user } = setup(open);
    await screen.findByRole('group', { name: 'Open tickets in this phase' });
    await user.click(screen.getByRole('radio', { name: /Reject/ }));
    expect(
      screen.queryByRole('group', { name: 'Open tickets in this phase' }),
    ).not.toBeInTheDocument();
  });

  it('completes the feature from the last phase, with no target phase', async () => {
    const { posts, user } = setup(pipelineAt('Release'));
    await screen.findByTestId('current-status');
    expect(screen.getByTestId('next-status')).toHaveTextContent('Complete');
    await user.click(screen.getByRole('button', { name: 'Complete feature' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ decision: 'approve', from_phase: 'Release' });
    expect(posts()[0]).not.toHaveProperty('to_phase');
  });
});

describe('the handoff dialog for an epic that is not on a pipeline', () => {
  it('stays the status dialog and never asks for a pipeline', async () => {
    const epic = makeTicket({
      key: 'FOOD-ENG-1',
      board_slug: 'eng',
      level: 'epic',
      status: 'Backlog',
    });
    const fetchMock = stubApi({ 'GET /api/people': people });
    render(
      <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
        <HandoffDialog
          request={{ ticket: epic, board: engBoard }}
          onClose={vi.fn()}
          onDone={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('current-status')).toHaveTextContent('Backlog');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/pipeline'))).toBe(false);
  });
});

/** The option labels of the select with this label. */
function within_select(label: string): string[] {
  return Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map(
    (o) => o.textContent ?? '',
  );
}
