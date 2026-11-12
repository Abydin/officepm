import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EpicPipeline } from '@officepm/shared';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { foodProject } from '@/test/fixtures';
import { jsonResponse, stubApi } from '@/test/helpers';
import { PhaseHistory } from './phase-history';
import { PipelineSettings } from './pipeline-settings';
import { PipelineStepper } from './pipeline-stepper';

const phases = [
  { name: 'Product', department: null, done: 0, total: 0 },
  { name: 'Design', department: 'Design', done: 1, total: 1 },
  { name: 'Engineering', department: 'Engineering', done: 1, total: 3 },
  { name: 'QA', department: null, done: 0, total: 0 },
];

describe('PipelineStepper', () => {
  it('lists every phase, marks the current one for assistive tech, and shows done of total', () => {
    render(<PipelineStepper phases={phases} current="Engineering" completed={false} />);
    const steps = within(screen.getByRole('list', { name: 'Pipeline' })).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual([
      expect.stringContaining('Product'),
      expect.stringContaining('Design'),
      expect.stringContaining('Engineering'),
      expect.stringContaining('QA'),
    ]);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(steps[2]).toHaveTextContent('Current');
    expect(steps[2]).toHaveTextContent('1 of 3 done');
    expect(steps[1]).toHaveTextContent('1 of 1 done');
    expect(steps[0]).not.toHaveAttribute('aria-current');
  });

  it('marks nothing current once the feature is complete', () => {
    render(<PipelineStepper phases={phases} current="QA" completed />);
    expect(
      within(screen.getByRole('list', { name: 'Pipeline' }))
        .getAllByRole('listitem')
        .some((s) => s.hasAttribute('aria-current')),
    ).toBe(false);
  });
});

describe('PhaseHistory', () => {
  const move = (
    over: Partial<EpicPipeline['history'][number]>,
  ): EpicPipeline['history'][number] => ({
    id: 'h',
    decision: 'approve',
    from_phase: 'Product',
    to_phase: 'Design',
    completed: false,
    reason: null,
    note: null,
    from_name: 'Maya Okafor',
    to_names: [],
    to_department: null,
    created_at: '2026-11-11 10:00:00',
    ...over,
  });

  it('renders nothing for no moves', () => {
    const { container } = render(<PhaseHistory moves={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says who moved, where, why, and to whom, oldest first', () => {
    render(
      <PhaseHistory
        moves={[
          move({
            id: '1',
            note: 'Brief attached',
            to_names: ['Sam Adeyemi'],
            to_department: 'Design',
          }),
          move({
            id: '2',
            decision: 'reject',
            from_phase: 'Design',
            to_phase: 'Product',
            reason: 'Scope unclear',
          }),
          move({ id: '3', from_phase: 'Release', to_phase: null, completed: true }),
        ]}
      />,
    );
    const items = within(screen.getByRole('list', { name: 'Pipeline history' })).getAllByRole(
      'listitem',
    );
    expect(items[0]).toHaveTextContent('Moved from Product to Design');
    expect(items[0]).toHaveTextContent('Maya Okafor');
    expect(items[0]).toHaveTextContent('to Sam Adeyemi');
    expect(items[0]).toHaveTextContent('Brief attached');
    expect(items[1]).toHaveTextContent('Sent back from Design to Product');
    expect(items[1]).toHaveTextContent('Reason: Scope unclear');
    expect(items[2]).toHaveTextContent('Completed the feature from Release');
  });
});

describe('PipelineSettings', () => {
  function setup(putResponse?: () => Response) {
    const puts: unknown[] = [];
    stubApi({
      'GET /api/projects': [foodProject],
      'GET /api/projects/food/pipeline': {
        configured: true,
        phases: [
          { name: 'Product', department: 'Product' },
          { name: 'Design', department: 'Design' },
          { name: 'Engineering', department: null },
        ],
      },
      'PUT /api/projects/food/pipeline': (init: RequestInit | undefined) => {
        puts.push(JSON.parse(String(init?.body)));
        return (
          putResponse?.() ??
          jsonResponse({ configured: true, phases: (puts.at(-1) as { phases: unknown[] }).phases })
        );
      },
    });
    render(
      <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
        <PipelineSettings />
      </QueryClientProvider>,
    );
    return { puts, user: userEvent.setup() };
  }

  it('shows the stored phases in order with their departments', async () => {
    setup();
    expect(await screen.findByLabelText('Phase 1 name')).toHaveValue('Product');
    expect(screen.getByLabelText('Phase 1 department')).toHaveValue('Product');
    expect(screen.getByLabelText('Phase 3 name')).toHaveValue('Engineering');
    expect(screen.getByLabelText('Phase 3 department')).toHaveValue('');
  });

  it('saves a rename with the old name, a reorder, an added phase and a removal', async () => {
    const { puts, user } = setup();
    const name1 = await screen.findByLabelText('Phase 1 name');
    await user.clear(name1);
    await user.type(name1, 'Discovery');
    await user.click(screen.getByRole('button', { name: 'Move Design down' }));
    await user.click(screen.getByRole('button', { name: 'Add phase' }));
    await user.type(screen.getByLabelText('Phase 4 name'), 'QA');
    await user.click(screen.getByRole('button', { name: 'Remove Design' }));
    await user.click(screen.getByRole('button', { name: 'Save phases' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      phases: [
        { name: 'Discovery', department: 'Product', was: 'Product' },
        { name: 'Engineering', department: null, was: 'Engineering' },
        { name: 'QA', department: null },
      ],
    });
    expect(await screen.findByText('Saved.')).toBeVisible();
  });

  it('keeps the first move disabled at the ends and will not save a blank name', async () => {
    const { user } = setup();
    await screen.findByLabelText('Phase 1 name');
    expect(screen.getByRole('button', { name: 'Move Product up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Engineering down' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Phase 2 name'));
    expect(screen.getByRole('button', { name: 'Save phases' })).toBeDisabled();
  });

  it('shows the server message when a removal is refused', async () => {
    const { user } = setup(() =>
      jsonResponse(
        { error: '"Design" is still used by 2 tickets: move them to another phase first' },
        409,
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Remove Design' }));
    await user.click(screen.getByRole('button', { name: 'Save phases' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '"Design" is still used by 2 tickets',
    );
  });
});
