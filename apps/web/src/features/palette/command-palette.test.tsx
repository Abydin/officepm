import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme } from '@/lib/theme';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { makeTicket, signedIn, ticketRoutes } from '@/test/fixtures';

afterEach(() => applyTheme('dark'));

const logo = makeTicket({ title: 'Logo refresh' });

function setup() {
  const created = { current: makeTicket({ id: 5, key: 'FOOD-DES-5', title: 'Poster' }) };
  const fetchMock = stubApi({
    ...signedIn,
    'GET /api/tickets': (_init, url) => {
      const q = url.searchParams.get('q')?.toLowerCase();
      const all = [logo];
      return jsonResponse(
        q ? all.filter((t) => `${t.key} ${t.title}`.toLowerCase().includes(q)) : all,
      );
    },
    ...ticketRoutes({ current: logo }),
    ...ticketRoutes(created),
    'POST /api/tickets': () => jsonResponse(created.current, 201),
  });
  return { fetchMock };
}

const palette = () => screen.findByRole('dialog', { name: 'Command palette' });

describe('command palette', () => {
  it('opens with Ctrl+K, finds a ticket by key on the server, and opens it in the drawer', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    const { router } = renderApp('/overview');
    await screen.findByRole('navigation', { name: 'Projects and boards' });

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await palette();
    await user.type(
      within(dialog).getByRole('combobox', { name: 'Search commands and tickets' }),
      'des-1',
    );
    const option = await within(dialog).findByRole('option', { name: /FOOD-DES-1/ });
    expect(option).toHaveTextContent('Logo refresh');
    await user.click(option);

    await waitFor(() => expect(router.state.location.search).toBe('?t=FOOD-DES-1'));
    expect(await screen.findByLabelText('Title')).toHaveValue('Logo refresh');
    const search = fetchMock.mock.calls
      .map(([url]) => String(url))
      .find((u) => u.includes('q=des-1'));
    expect(search).toContain('limit=8');
  });

  it('jumps to a board', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderApp('/overview');
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await palette();
    await user.type(
      within(dialog).getByRole('combobox', { name: 'Search commands and tickets' }),
      'design',
    );
    await user.click(await within(dialog).findByRole('option', { name: /Board: Food \/ Design/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/projects/food/boards/design'),
    );
  });

  it('toggles the theme', async () => {
    setup();
    const user = userEvent.setup();
    renderApp('/overview');
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await palette();
    await user.type(
      within(dialog).getByRole('combobox', { name: 'Search commands and tickets' }),
      'theme',
    );
    await user.click(await within(dialog).findByRole('option', { name: /Switch to light theme/ }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('creates a ticket: pick a board, type a title, press Enter, land in its drawer', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    const { router } = renderApp('/overview');
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await palette();
    await user.click(await within(dialog).findByRole('option', { name: /Create ticket/ }));
    await user.click(await within(dialog).findByRole('option', { name: /Food \/ Design/ }));
    await user.type(
      within(dialog).getByRole('combobox', { name: 'Search commands and tickets' }),
      'Poster{Enter}',
    );

    await waitFor(() => expect(router.state.location.search).toBe('?t=FOOD-DES-5'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      project_slug: 'food',
      board_slug: 'design',
      title: 'Poster',
      type: 'task',
    });
  });

  it('opens with / and the help with ?, but not while typing in a field', async () => {
    setup();
    const user = userEvent.setup();
    renderApp('/projects/food/boards/design');
    await screen.findByLabelText('New ticket title');

    await user.click(screen.getByLabelText('New ticket title'));
    await user.keyboard('/');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(document.body);
    await user.keyboard('?');
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.keyboard('/');
    await palette();
  });

  it('C focuses the title box on a board', async () => {
    setup();
    const user = userEvent.setup();
    renderApp('/projects/food/boards/design');
    const input = await screen.findByLabelText('New ticket title');
    await user.click(document.body);
    await user.keyboard('c');
    expect(input).toHaveFocus();
  });

  it('J highlights the first card and Enter opens it', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderApp('/projects/food/boards/design');
    await screen.findByText('Logo refresh');
    await user.click(document.body);
    await user.keyboard('j');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.search).toBe('?t=FOOD-DES-1'));
  });
});
