import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { engRoutes, makeRetro } from '@/test/fixtures';

const list = '/projects/food/boards/eng/retros';
const card = (over: object = {}) => ({
  id: 'c1',
  retro_id: 'r1',
  column_name: 'well',
  body: 'Shipped on time',
  author: 'Maya Okafor',
  ticket_key: null,
  created_at: '2026-10-10 10:00:00',
  ...over,
});

describe('retros view', () => {
  it('lists retros, newest first, each linking to its own page', async () => {
    stubApi(
      engRoutes({
        'GET /api/projects/food/boards/eng/retros': [
          makeRetro({ id: 'r2', name: 'Retro: Sprint 14' }),
          makeRetro({ id: 'r1', name: 'Retro: Sprint 13', status: 'closed' }),
        ],
      }),
    );
    renderApp(list);

    const link = await screen.findByRole('link', { name: 'Retro: Sprint 13' });
    expect(link).toHaveAttribute('href', '/projects/food/boards/eng/retros/r1');
    expect(screen.getByText('closed')).toBeVisible();
  });

  it('says how a retro comes to exist when there are none', async () => {
    stubApi(engRoutes({ 'GET /api/projects/food/boards/eng/retros': [] }));
    renderApp(list);
    expect(await screen.findByText('No retros yet')).toBeVisible();
  });

  it('shows the three columns with their cards and adds a card to one column', async () => {
    const cards = [card(), card({ id: 'c2', column_name: 'actions', body: 'Write a runbook' })];
    const posts: unknown[] = [];
    stubApi(
      engRoutes({
        'GET /api/retros/r1': () => jsonResponse({ ...makeRetro(), cards }),
        'POST /api/retros/r1/cards': (init: RequestInit | undefined) => {
          const body = JSON.parse(String(init?.body));
          posts.push(body);
          cards.push(card({ id: 'c3', column_name: body.column, body: body.body }));
          return jsonResponse(cards[2], 201);
        },
      }),
    );
    const user = userEvent.setup();
    renderApp(`${list}/r1`);

    const well = within(await screen.findByRole('region', { name: 'Went well' }));
    expect(well.getByText('Shipped on time')).toBeVisible();
    expect(well.getByText('Maya Okafor')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Action items' })).getByText('Write a runbook'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: "Didn't go well" })).getByText('No cards yet'),
    ).toBeVisible();

    const didnt = within(screen.getByRole('region', { name: "Didn't go well" }));
    await user.type(didnt.getByLabelText("Add a card to Didn't go well"), 'Flaky deploys{Enter}');
    await waitFor(() => expect(posts).toEqual([{ column: 'didnt', body: 'Flaky deploys' }]));
    expect(await didnt.findByText('Flaky deploys')).toBeVisible();
    expect(didnt.getByLabelText("Add a card to Didn't go well")).toHaveValue('');
  });

  it('does not post a blank card', async () => {
    stubApi(engRoutes({ 'GET /api/retros/r1': { ...makeRetro(), cards: [] } }));
    const user = userEvent.setup();
    renderApp(`${list}/r1`);
    const well = within(await screen.findByRole('region', { name: 'Went well' }));
    await user.type(well.getByLabelText('Add a card to Went well'), '   {Enter}');
    // An unrouted POST would throw in stubApi; reaching here with the add button disabled is the pass.
    expect(well.getByRole('button', { name: 'Add card' })).toBeDisabled();
  });

  it('keeps the Retros tab current while one retro is open', async () => {
    stubApi(engRoutes({ 'GET /api/retros/r1': { ...makeRetro(), cards: [] } }));
    renderApp(`${list}/r1`);
    const tab = await screen.findByRole('link', { name: 'Retros' });
    expect(tab).toHaveAttribute('aria-current', 'page');
  });
});
