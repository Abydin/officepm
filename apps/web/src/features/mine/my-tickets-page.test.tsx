import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { makeTicket, signedIn, ticketRoutes } from '@/test/fixtures';

describe('My Tickets', () => {
  it('lists the tickets assigned to me and opens one in the drawer', async () => {
    const mine = makeTicket({ title: 'Logo refresh', status: 'In Progress', priority: 'high' });
    stubApi({
      ...signedIn,
      'GET /api/my-tickets': [mine],
      'GET /api/my-tickets/participating': [],
      'GET /api/tickets': [mine],
      ...ticketRoutes({ current: mine }),
    });
    const user = userEvent.setup();
    const { router } = renderApp('/mine');

    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /FOOD-DES-1/ });
    expect(row).toHaveTextContent('In Progress');
    expect(row).toHaveTextContent('food/design');

    await user.click(within(row).getByRole('button', { name: /Logo refresh/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?t=FOOD-DES-1'));
    expect(await screen.findByRole('dialog')).toBeVisible();
  });

  it('says so when nothing is assigned', async () => {
    stubApi({ ...signedIn, 'GET /api/my-tickets': [], 'GET /api/my-tickets/participating': [] });
    renderApp('/mine');
    expect(await screen.findByText('Nothing assigned to you')).toBeVisible();
  });

  it('lists tickets I am a participant on in their own section, apart from the assigned ones', async () => {
    const mine = makeTicket({ title: 'Assigned one' });
    const shared = makeTicket({ key: 'FOOD-DES-2', id: 2, title: 'Shared with me' });
    stubApi({
      ...signedIn,
      'GET /api/my-tickets': [mine],
      'GET /api/my-tickets/participating': [shared],
    });
    renderApp('/mine');
    const assigned = await screen.findByRole('table', { name: 'Assigned to you' });
    expect(within(assigned).getByText('Assigned one')).toBeVisible();
    expect(within(assigned).queryByText('Shared with me')).toBeNull();
    const also = await screen.findByRole('table', { name: 'Also on' });
    expect(within(also).getByText('Shared with me')).toBeVisible();
  });

  it('shows no Also on section when there is nothing to list', async () => {
    stubApi({
      ...signedIn,
      'GET /api/my-tickets': [makeTicket()],
      'GET /api/my-tickets/participating': [],
    });
    renderApp('/mine');
    await screen.findByRole('table', { name: 'Assigned to you' });
    expect(screen.queryByRole('heading', { name: 'Also on' })).toBeNull();
  });

  it('shows the server error instead of an empty list', async () => {
    stubApi({ ...signedIn, 'GET /api/my-tickets': jsonResponse({ error: 'boom' }, 500) });
    renderApp('/mine');
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});

describe('#/t/KEY short link', () => {
  it('continues to the ticket board with the drawer open', async () => {
    const ticket = makeTicket();
    stubApi({
      ...signedIn,
      'GET /api/tickets': [ticket],
      ...ticketRoutes({ current: ticket }),
    });
    const { router } = renderApp('/t/FOOD-DES-1');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/projects/food/boards/design'),
    );
    expect(router.state.location.search).toBe('?t=FOOD-DES-1');
    expect(await screen.findByRole('dialog')).toBeVisible();
  });
});
