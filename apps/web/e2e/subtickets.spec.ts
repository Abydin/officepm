import { expect, test, type Page } from '@playwright/test';
import { card, removeTickets, signIn } from './helpers';

// Statuses other than In Progress: the Design board limits that column to 3, and the a11y
// specs check the board in both themes, where an over-limit badge has a contrast problem of its own.
const made: string[] = [];

async function newTicket(page: Page, title: string, status = 'Backlog') {
  const res = await page.request.post('/api/tickets', {
    data: { project_slug: 'food', board_slug: 'design', title, type: 'task', status },
  });
  expect(res.status()).toBe(201);
  const key = ((await res.json()) as { key: string }).key;
  made.push(key);
  return key;
}

async function addSubticket(page: Page, title: string) {
  const input = page.getByRole('dialog').getByRole('textbox', { name: 'New sub-ticket title' });
  await input.fill(title);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  await removeTickets(page, made.splice(0));
});

test('adds sub-tickets from the drawer, counts progress on the card and marks the children', async ({
  page,
}) => {
  const parent = await newTicket(page, 'Sub: checkout page');
  await page.goto(`/#/projects/food/boards/design?t=${parent}`);
  const drawer = page.getByRole('dialog');
  const section = drawer.getByRole('region', { name: /Sub-tickets/ });

  await addSubticket(page, 'Build the form');
  const list = section.getByRole('list', { name: 'Sub-tickets' });
  await expect(list.getByRole('button', { name: /Build the form/ })).toBeVisible();
  await addSubticket(page, 'Wire the payment call');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  // The new row has its own key from the normal numbering, a status and an assignee avatar.
  const first = list.getByRole('button', { name: /Build the form/ });
  await expect(first).toContainText(/FOOD-DES-\d+/);
  await expect(first).toContainText('Backlog');
  await expect(first.getByRole('img', { name: 'Unassigned' })).toBeVisible();
  await expect(section.getByRole('heading')).toContainText('0/2 done');

  // Finish one through the API (the ticket workflow is the same as any ticket's), then look at the board.
  const detail = (await (await page.request.get(`/api/tickets/${parent}`)).json()) as {
    subtickets: Array<{ key: string; title: string }>;
  };
  const done = detail.subtickets.find((s) => s.title === 'Build the form')!;
  expect(
    (await page.request.patch(`/api/tickets/${done.key}`, { data: { status: 'Done' } })).status(),
  ).toBe(200);
  await drawer.getByRole('button', { name: 'Close ticket' }).click();
  await expect(card(page, parent)).toContainText('1/2');
  await expect(card(page, done.key)).toContainText(`sub of ${parent}`);
  await expect(page.getByText(/\d+ tickets · \d+ done · \d+ sub-tickets/)).toBeVisible();

  // Clicking a sub-ticket opens it, and the drawer says whose it is.
  await card(page, parent).click();
  await drawer.getByRole('button', { name: /Wire the payment call/ }).click();
  await expect(drawer.getByRole('button', { name: `sub of ${parent}, open parent` })).toBeVisible();
  await drawer.getByRole('button', { name: `sub of ${parent}, open parent` }).click();
  await expect(drawer.getByLabel('Title', { exact: true })).toHaveValue('Sub: checkout page');
});

test('shows the one level rule when a sub-ticket is given a sub-ticket', async ({ page }) => {
  const parent = await newTicket(page, 'Sub: depth');
  await page.goto(`/#/projects/food/boards/design?t=${parent}`);
  await addSubticket(page, 'Child');
  const drawer = page.getByRole('dialog');
  await drawer
    .getByRole('list', { name: 'Sub-tickets' })
    .getByRole('button', { name: /Child/ })
    .click();
  await expect(drawer.getByLabel('Title', { exact: true })).toHaveValue('Child');

  await addSubticket(page, 'Grandchild');
  await expect(drawer.getByRole('alert')).toContainText('one level deep');
  // Nothing was created: the child still has no sub-tickets.
  await expect(drawer.getByRole('list', { name: 'Sub-tickets' })).toHaveCount(0);
});

test('closing a parent with open sub-tickets warns and needs Close anyway', async ({ page }) => {
  const parent = await newTicket(page, 'Sub: close warning', 'Review');
  await page.goto(`/#/projects/food/boards/design?t=${parent}`);
  const items = page
    .getByRole('dialog')
    .getByRole('list', { name: 'Sub-tickets' })
    .getByRole('listitem');
  await addSubticket(page, 'Still open one');
  await expect(items).toHaveCount(1);
  await addSubticket(page, 'Still open two');
  await expect(items).toHaveCount(2);

  await page.getByRole('dialog').getByLabel('Status').selectOption('Done');
  const dialog = page.getByRole('dialog', { name: `Move ${parent}` });
  await expect(dialog.getByText('2 of 2 sub-tickets are still open.')).toBeVisible();
  const approve = dialog.getByRole('button', { name: 'Approve and move' });
  await expect(approve).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Close anyway' }).check();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(dialog).toHaveCount(0);
  const after = (await (await page.request.get(`/api/tickets/${parent}`)).json()) as {
    status: string;
    progress: { done: number; total: number };
  };
  expect(after.status).toBe('Done');
  // Closing the parent did not close the children.
  expect(after.progress).toEqual({ done: 0, total: 2 });
});

test('the API enforces the same warning for a caller that skips the dialog', async ({ page }) => {
  const parent = await newTicket(page, 'Sub: api warning', 'Review');
  await page.request.post(`/api/tickets/${parent}/subtickets`, { data: { title: 'open' } });
  const refused = await page.request.post(`/api/tickets/${parent}/handoff`, {
    data: { decision: 'approve', to_status: 'Done' },
  });
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { error: string }).error).toMatch(/1 sub-ticket is still open/);
});

test('the Sub-tickets section fits a phone and its field works from the keyboard', async ({
  page,
}) => {
  const parent = await newTicket(page, 'Sub: phone');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/#/projects/food/boards/design?t=${parent}`);
  const drawer = page.getByRole('dialog');
  const input = drawer.getByRole('textbox', { name: 'New sub-ticket title' });
  await input.scrollIntoViewIfNeeded();
  await input.focus();
  await page.keyboard.type('Typed with the keyboard');
  await page.keyboard.press('Enter');
  const row = drawer
    .getByRole('list', { name: 'Sub-tickets' })
    .getByRole('button', { name: /Typed with the keyboard/ });
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await drawer.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  // Reachable and operable without a pointer.
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(drawer.getByLabel('Title', { exact: true })).toHaveValue('Typed with the keyboard');
});
