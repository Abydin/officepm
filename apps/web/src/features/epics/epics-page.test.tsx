import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp, stubApi } from '@/test/helpers';
import { engRoutes, makeTicket } from '@/test/fixtures';

const URL_ = '/projects/food/boards/eng/epics';

describe('epics view', () => {
  it('shows each epic with how many of its tickets are done', async () => {
    stubApi(
      engRoutes({
        'GET /api/tickets': [
          makeTicket({ key: 'FOOD-ENG-1', title: 'Group ordering', level: 'epic' }),
          makeTicket({ id: 2, key: 'FOOD-ENG-2', parent_key: 'FOOD-ENG-1', status: 'Done' }),
          makeTicket({ id: 3, key: 'FOOD-ENG-3', parent_key: 'FOOD-ENG-1', status: 'In Progress' }),
          makeTicket({ id: 4, key: 'FOOD-ENG-4', title: 'Loose story', level: 'story' }),
        ],
      }),
    );
    renderApp(URL_);

    const epic = within(await screen.findByRole('region', { name: /Group ordering/ }));
    expect(epic.getByText('1 of 2 done')).toBeVisible();
    expect(epic.getByRole('progressbar', { name: /Group ordering progress/ })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(screen.queryByText('Loose story')).not.toBeInTheDocument();
  });

  it('opens an epic in the ticket drawer', async () => {
    stubApi(
      engRoutes({
        'GET /api/tickets': [
          makeTicket({ key: 'FOOD-ENG-1', title: 'Group ordering', level: 'epic' }),
        ],
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp(URL_);

    await user.click(await screen.findByRole('button', { name: /FOOD-ENG-1/ }));
    expect(router.state.location.search).toBe('?t=FOOD-ENG-1');
  });

  it('says so when the board has no epics', async () => {
    stubApi(engRoutes({ 'GET /api/tickets': [makeTicket({ level: 'story' })] }));
    renderApp(URL_);
    expect(await screen.findByText('No epics on this board yet')).toBeVisible();
  });
});
