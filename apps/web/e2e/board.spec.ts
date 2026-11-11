import { expect, test } from '@playwright/test';
import { card, column, dragCard, keyboardDrag, signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('drags a card to another column with the mouse, and it is still there after a reload', async ({
  page,
}) => {
  await page.goto('/#/projects/food/boards/design');
  await expect(card(column(page, 'Backlog'), 'FOOD-DES-2')).toBeVisible();

  await dragCard(page, 'FOOD-DES-2', 'In Progress');

  // The drop asks first, and the card has not moved yet.
  const dialog = page.getByRole('dialog', { name: /Move FOOD-DES-2/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Move to' })).toHaveValue('In Progress');
  await dialog.getByRole('button', { name: 'Approve and move' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(card(column(page, 'In Progress'), 'FOOD-DES-2')).toBeVisible();
  await expect(card(column(page, 'Backlog'), 'FOOD-DES-2')).toHaveCount(0);

  await page.reload();
  await expect(card(column(page, 'In Progress'), 'FOOD-DES-2')).toBeVisible();
});

test('moves a card with the keyboard alone: Space, arrow, Space', async ({ page }) => {
  await page.goto('/#/projects/food/boards/design');
  await expect(column(page, 'In Progress')).toContainText('FOOD-DES-1');

  await keyboardDrag(page, 'FOOD-DES-1', ['Review']);
  await page
    .getByRole('dialog', { name: /Move FOOD-DES-1/ })
    .getByRole('button', { name: 'Approve and move' })
    .click();

  await expect(card(column(page, 'Review'), 'FOOD-DES-1')).toBeVisible();
  // Focus follows the card, so the next key press still acts on it.
  await expect(card(page, 'FOOD-DES-1')).toBeFocused();
  await page.reload();
  await expect(card(column(page, 'Review'), 'FOOD-DES-1')).toBeVisible();
});

test('a waterfall board will not skip a phase: the dialog explains and offers the next one', async ({
  page,
}) => {
  await page.goto('/#/projects/acme/boards/eng');
  const startColumn = column(page, 'Requirements');
  await expect(card(startColumn, 'ACME-ENG-2')).toBeVisible();

  await keyboardDrag(page, 'ACME-ENG-2', ['Design', 'Implementation']);

  const dialog = page.getByRole('dialog', { name: /Move ACME-ENG-2/ });
  await expect(dialog.getByRole('status')).toContainText('sequential only');
  await expect(dialog.getByRole('combobox', { name: 'Move to' })).toHaveValue('Design');
  await expect(dialog.getByRole('combobox', { name: 'Move to' }).locator('option')).toHaveText([
    'Design',
  ]);

  // Cancel: nothing changes, here and on the server.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(card(startColumn, 'ACME-ENG-2')).toBeVisible();
  await page.reload();
  await expect(card(column(page, 'Requirements'), 'ACME-ENG-2')).toBeVisible();
});

test('filters the board by text and by label, and shares the filter in the address', async ({
  page,
}) => {
  await page.goto('/#/projects/food/boards/eng');
  await expect(page.locator('[data-ticket-key]').first()).toBeVisible();
  const all = await page.locator('[data-ticket-key]').count();

  await page.getByLabel('Text').fill('printer');
  await expect(page.locator('[data-ticket-key]')).toHaveCount(1);
  await expect(page).toHaveURL(/q=printer/);
  await expect(page.getByText(`1 of ${all} tickets shown`)).toBeVisible();

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('[data-ticket-key]')).toHaveCount(all);
  await page.getByLabel('Label').selectOption('kitchen');
  await expect(page.locator('[data-ticket-key]').first()).toBeVisible();
  expect(await page.locator('[data-ticket-key]').count()).toBeLessThan(all);
});

test('My Tickets lists what is assigned to me and opens one in the drawer', async ({ page }) => {
  await page
    .getByRole('navigation', { name: 'Projects and boards' })
    .getByText('My Tickets')
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Tickets' })).toBeVisible();
  await page.getByRole('button', { name: /Group order summary page/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Group order summary page');
});
