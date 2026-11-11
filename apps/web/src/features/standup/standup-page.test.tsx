import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, stubApi } from '@/test/helpers';
import { engRoutes, makeTicket } from '@/test/fixtures';

describe('standup view', () => {
  it('lists each person with their tickets, status and blockers, and the unassigned last', async () => {
    stubApi(
      engRoutes({
        'GET /api/tickets': [
          makeTicket({
            key: 'FOOD-ENG-1',
            title: 'Fix totals',
            assignee: 'tunde.bakare@x.demo',
            status: 'In Progress',
          }),
          makeTicket({
            id: 2,
            key: 'FOOD-ENG-2',
            title: 'Printer layout',
            assignee: 'tunde.bakare@x.demo',
            blocked: true,
            blocker_reason: 'Waiting on the licence',
          }),
          makeTicket({ id: 3, key: 'FOOD-ENG-3', title: 'Orphan', assignee: null }),
        ],
      }),
    );
    renderApp('/projects/food/boards/eng/standup');

    const tunde = within(await screen.findByRole('region', { name: 'Tunde Bakare' }));
    expect(tunde.getAllByRole('listitem')).toHaveLength(2);
    expect(tunde.getByText('In Progress')).toBeVisible();
    expect(tunde.getByText('Blocked: Waiting on the licence')).toBeVisible();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Tunde Bakare', 'Unassigned']);
  });

  it('says so on a board with no tickets', async () => {
    stubApi(engRoutes({ 'GET /api/tickets': [] }));
    renderApp('/projects/food/boards/eng/standup');
    expect(await screen.findByText('Nothing to report')).toBeVisible();
  });
});
