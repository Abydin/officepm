import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { makeTicket } from '@/test/fixtures';
import { jsonResponse, stubApi } from '@/test/helpers';
import { PeopleSection } from './people-section';

const people = [
  { id: 1, name: 'Maya Okafor', department: 'Design' },
  { id: 2, name: 'Sam Adeyemi', department: 'Engineering' },
  { id: 3, name: 'Tunde Bakare', department: 'Engineering' },
];

function setup(
  participants = [{ id: 3, name: 'Tunde Bakare', department: 'Engineering', role: 'Backend' }],
) {
  const ticket = makeTicket({ participants });
  const fetchMock = stubApi({
    'GET /api/people': people,
    'POST /api/tickets/FOOD-DES-1/participants': (init) =>
      jsonResponse(
        {
          id: 2,
          name: 'Sam Adeyemi',
          department: 'Engineering',
          role: JSON.parse(String(init?.body)).role,
        },
        201,
      ),
    'DELETE /api/tickets/FOOD-DES-1/participants/3': { ok: true },
    'GET /api/tickets/FOOD-DES-1': ticket,
  });
  render(
    <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
      <PeopleSection ticket={ticket} />
    </QueryClientProvider>,
  );
  const calls = (method: string) =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === method)
      .map(([url, init]) => ({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      }));
  return { user: userEvent.setup(), calls };
}

const openForm = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Add a person' }));

describe('PeopleSection', () => {
  it('lists the people on the ticket with department and role, and nothing like an email', () => {
    setup();
    const list = screen.getByRole('list', { name: 'People on this ticket' });
    expect(within(list).getByText('Tunde Bakare')).toBeVisible();
    expect(list).toHaveTextContent('Engineering');
    expect(list).toHaveTextContent('Backend');
    expect(list.textContent).not.toContain('@');
  });

  it('is just the add button when no one else is on it, and keeps the form shut until asked', () => {
    setup([]);
    expect(screen.queryByRole('list', { name: 'People on this ticket' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a person' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /Role/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Person to add/ })).toBeNull();
  });

  it('adds a person with a role, then clears the form', async () => {
    const { user, calls } = setup();
    await openForm(user);
    await user.click(screen.getByRole('button', { name: /Person to add/ }));
    await user.click(await screen.findByRole('option', { name: /Sam Adeyemi/ }));
    expect(screen.getByRole('button', { name: 'Person to add: Sam Adeyemi' })).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: /Role/ }), '  Frontend ');
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(calls('POST')[0]).toEqual({
      url: '/api/tickets/FOOD-DES-1/participants',
      body: { user_id: 2, role: 'Frontend' },
    });
    // A successful add closes the popover; the form comes back empty.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Role/ })).toBeNull());
    await openForm(user);
    expect(screen.getByRole('textbox', { name: /Role/ })).toHaveValue('');
    expect(screen.getByRole('button', { name: /Person to add: Choose a person/ })).toBeVisible();
  });

  it('sends a null role when none was typed, and keeps Add person off until someone is chosen', async () => {
    const { user, calls } = setup();
    await openForm(user);
    expect(screen.getByRole('button', { name: 'Add person' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Person to add/ }));
    await user.click(await screen.findByRole('option', { name: /Sam Adeyemi/ }));
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(calls('POST')[0]!.body).toEqual({ user_id: 2, role: null });
  });

  it('limits the role field to 30 characters', async () => {
    const { user } = setup();
    await openForm(user);
    expect(screen.getByRole('textbox', { name: /Role/ })).toHaveAttribute('maxlength', '30');
  });

  it('filters the picker by department and leaves out people already on the ticket', async () => {
    const { user } = setup();
    await openForm(user);
    await screen.findByRole('option', { name: 'Engineering' });
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Department' }),
      'Engineering',
    );
    await user.click(screen.getByRole('button', { name: /Person to add/ }));
    const options = within(await screen.findByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toHaveLength(1);
    expect(options[0]).toContain('Sam Adeyemi');
    expect(options.join()).not.toContain('Tunde');
  });

  it('removes a person', async () => {
    const { user, calls } = setup();
    await user.click(screen.getByRole('button', { name: 'Remove Tunde Bakare' }));
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
    expect(calls('DELETE')[0]!.url).toBe('/api/tickets/FOOD-DES-1/participants/3');
  });

  it('shows the server message when adding is refused', async () => {
    const ticket = makeTicket({ participants: [] });
    stubApi({
      'GET /api/people': people,
      'POST /api/tickets/FOOD-DES-1/participants': jsonResponse(
        { error: 'that person is the assignee already' },
        409,
      ),
      'GET /api/tickets/FOOD-DES-1': ticket,
    });
    render(
      <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
        <PeopleSection ticket={ticket} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await openForm(user);
    await user.click(screen.getByRole('button', { name: /Person to add/ }));
    await user.click(await screen.findByRole('option', { name: /Sam Adeyemi/ }));
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the assignee already');
  });
});
