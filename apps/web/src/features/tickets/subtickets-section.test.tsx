import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { makeTicket } from '@/test/fixtures';
import { jsonResponse, stubApi } from '@/test/helpers';
import { SubticketsSection } from './subtickets-section';

const Where = () => <output aria-label="location">{useLocation().search}</output>;

function setup(over: Parameters<typeof makeTicket>[0] = {}, post?: () => Response) {
  const ticket = makeTicket({
    subtickets: [
      {
        key: 'FOOD-DES-2',
        title: 'Write the form',
        status: 'Done',
        type: 'task',
        assignee_name: 'Sam Adeyemi',
      },
      {
        key: 'FOOD-DES-3',
        title: 'Wire the API',
        status: 'In Progress',
        type: 'task',
        assignee_name: null,
      },
    ],
    progress: { done: 1, total: 2 },
    ...over,
  });
  const fetchMock = stubApi({
    'POST /api/tickets/FOOD-DES-1/subtickets':
      post ??
      (() => jsonResponse(makeTicket({ key: 'FOOD-DES-4', subticket_of: 'FOOD-DES-1' }), 201)),
  });
  render(
    <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
      <MemoryRouter>
        <SubticketsSection ticket={ticket} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const posts = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init?.body)) }));
  return { user: userEvent.setup(), posts };
}

describe('SubticketsSection', () => {
  it('lists each sub-ticket with key, status and assignee, and the done count', () => {
    setup();
    expect(screen.getByRole('heading', { name: /Sub-tickets/ })).toHaveTextContent('1/2 done');
    const list = screen.getByRole('list', { name: 'Sub-tickets' });
    const first = within(list).getByRole('button', { name: /FOOD-DES-2/ });
    expect(first).toHaveTextContent('Write the form');
    expect(first).toHaveTextContent('Done');
    expect(within(first).getByRole('img', { name: 'Sam Adeyemi' })).toBeVisible();
    const second = within(list).getByRole('button', { name: /FOOD-DES-3/ });
    expect(within(second).getByRole('img', { name: 'Unassigned' })).toBeVisible();
  });

  it('opens a sub-ticket in the drawer when it is clicked', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /FOOD-DES-3/ }));
    expect(screen.getByLabelText('location')).toHaveTextContent('?t=FOOD-DES-3');
  });

  it('adds one when a title is typed and Enter is pressed, then clears the field', async () => {
    const { user, posts } = setup();
    await user.type(
      screen.getByRole('textbox', { name: 'New sub-ticket title' }),
      '  Test it {Enter}',
    );
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toEqual({
      url: '/api/tickets/FOOD-DES-1/subtickets',
      body: { title: 'Test it' },
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'New sub-ticket title' })).toHaveValue(''),
    );
  });

  it('does nothing for a blank title', async () => {
    const { user, posts } = setup();
    await user.type(screen.getByRole('textbox', { name: 'New sub-ticket title' }), '   {Enter}');
    expect(posts()).toHaveLength(0);
  });

  it('shows the depth rule message from the server and keeps the typed title', async () => {
    const { user } = setup(
      { subticket_of: 'FOOD-DES-9', subtickets: [], progress: { done: 0, total: 0 } },
      () =>
        jsonResponse(
          {
            error:
              'sub-tickets go one level deep: FOOD-DES-1 is already a sub-ticket of FOOD-DES-9',
          },
          409,
        ),
    );
    const input = screen.getByRole('textbox', { name: 'New sub-ticket title' });
    await user.type(input, 'Grandchild{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('one level deep');
    expect(input).toHaveValue('Grandchild');
  });

  it('has no list and no done count when there are none', () => {
    setup({ subtickets: [], progress: { done: 0, total: 0 } });
    expect(screen.queryByRole('list', { name: 'Sub-tickets' })).toBeNull();
    expect(screen.getByRole('heading', { name: /Sub-tickets/ })).not.toHaveTextContent('done');
  });
});

describe('SubticketsSection typing while a save is pending', () => {
  it('keeps text typed after pressing Enter instead of clearing it when the first save lands', async () => {
    let release: (r: Response) => void = () => {};
    const { user, posts } = setup(
      {},
      (() =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })) as never,
    );
    const input = screen.getByRole('textbox', { name: 'New sub-ticket title' });
    await user.type(input, 'First{Enter}');
    await waitFor(() => expect(posts()).toHaveLength(1));
    await user.type(input, 'Second');
    release(jsonResponse(makeTicket({ key: 'FOOD-DES-4', subticket_of: 'FOOD-DES-1' }), 201));
    await waitFor(() => expect(input).toHaveValue('FirstSecond'));
  });
});
