import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { engBoard, engRoutes, makeTicket, ticketRoutes } from '@/test/fixtures';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';

function setup(reject?: string) {
  const created = { current: makeTicket({ id: 9, key: 'FOOD-ENG-9', board_slug: 'eng' }) };
  const fetchMock = stubApi(
    engRoutes({
      'GET /api/tickets': [],
      ...ticketRoutes(created),
      'POST /api/tickets': () =>
        reject ? jsonResponse({ error: reject }, 409) : jsonResponse(created.current, 201),
    }),
  );
  const posts = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
  return { posts };
}

const titleBox = () => screen.findByLabelText('New ticket title');

describe('board quick-add', () => {
  it('creates a task, not the leading epic, by default', async () => {
    const { posts } = setup();
    const user = userEvent.setup();
    renderApp('/projects/food/boards/eng');
    const box = await titleBox();
    expect(screen.getByRole('combobox', { name: 'Ticket type' })).toHaveValue('task');
    await user.type(box, 'Add a login{Enter}');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ title: 'Add a login', type: 'task' });
  });

  it('creates the type picked in the type select', async () => {
    const { posts } = setup();
    const user = userEvent.setup();
    renderApp('/projects/food/boards/eng');
    const box = await titleBox();
    const select = screen.getByRole('combobox', { name: 'Ticket type' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(engBoard.types);
    await user.selectOptions(select, 'epic');
    await user.type(box, 'Checkout{Enter}');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ type: 'epic' });
  });

  it('opens the new ticket in the drawer and clears the box', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderApp('/projects/food/boards/eng');
    const box = await titleBox();
    await user.type(box, 'Add a login{Enter}');
    await waitFor(() => expect(router.state.location.search).toBe('?t=FOOD-ENG-9'));
    expect(box).toHaveValue('');
  });

  it('shows the server message inline and keeps the title when it is rejected', async () => {
    setup('type must be one of: story');
    const user = userEvent.setup();
    renderApp('/projects/food/boards/eng');
    const box = await titleBox();
    await user.type(box, 'Add a login{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('type must be one of: story');
    expect(box).toHaveValue('Add a login');
  });

  it('says so when Enter is pressed with no title, and creates nothing', async () => {
    const { posts } = setup();
    const user = userEvent.setup();
    renderApp('/projects/food/boards/eng');
    await user.type(await titleBox(), '   {Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a title');
    expect(posts()).toHaveLength(0);
  });
});
