import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('edits a ticket in the drawer and the edits survive a reload', async ({ page }) => {
  await page.goto('/#/projects/food/boards/design');
  await page.locator('[data-ticket-key="FOOD-DES-2"]').click();
  const drawer = page.getByRole('dialog');
  await expect(page).toHaveURL(/\?t=FOOD-DES-2$/);

  await drawer.getByLabel('Title', { exact: true }).fill('Empty state illustrations, v2');
  await drawer.getByLabel('Title', { exact: true }).blur();
  await drawer.getByLabel('Priority').selectOption('urgent');
  await drawer.getByLabel('Due date').fill('2030-05-17');
  await drawer.getByLabel('Due date').blur();

  await drawer.getByRole('button', { name: /^Assignee/ }).click();
  await page.getByRole('combobox', { name: /Find a person/ }).fill('priya');
  await page.getByRole('option', { name: /Priya/ }).click();

  await drawer.getByRole('button', { name: 'Add label' }).click();
  await page.getByRole('combobox', { name: /Find a label/ }).fill('print');
  await page.getByRole('option', { name: /Use "print"/ }).click();
  await expect(drawer.getByRole('button', { name: 'Remove label print' })).toBeVisible();

  await drawer.getByLabel('Add a comment').fill('Drafts are in the shared folder');
  await drawer.getByRole('button', { name: 'Comment' }).click();
  await expect(drawer.getByText('Drafts are in the shared folder')).toBeVisible();

  // Escape closes it and the board behind it is intact.
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/boards\/design$/);

  // The ticket's own short link opens the same drawer after a full reload.
  await page.goto('/#/t/FOOD-DES-2');
  await page.reload();
  const again = page.getByRole('dialog');
  await expect(again.getByLabel('Title', { exact: true })).toHaveValue(
    'Empty state illustrations, v2',
  );
  await expect(again.getByLabel('Priority')).toHaveValue('urgent');
  await expect(again.getByLabel('Due date')).toHaveValue('2030-05-17');
  await expect(again.getByRole('button', { name: 'Assignee: Priya Nair' })).toBeVisible();
  await expect(again.getByRole('button', { name: 'Remove label print' })).toBeVisible();
  await expect(again.getByText('Drafts are in the shared folder')).toBeVisible();
  await expect(page).toHaveURL(/boards\/design\?t=FOOD-DES-2$/);
});

test('uploads an attachment and offers it for download', async ({ page }) => {
  await page.goto('/#/t/FOOD-DES-1');
  const drawer = page.getByRole('dialog');
  await drawer.getByTestId('attachment-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello from the e2e run'),
  });
  await expect(drawer.getByText('notes.txt', { exact: false }).first()).toBeVisible();

  const download = page.waitForEvent('download');
  await drawer.getByRole('link', { name: /Download notes.txt/ }).click();
  expect((await download).suggestedFilename()).toBe('notes.txt');
});

test('shows the GitHub panel on a board that has it', async ({ page }) => {
  await page.goto('/#/projects/food/boards/eng');
  await page.locator('[data-ticket-key="FOOD-ENG-8"]').click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'GitHub' })).toBeVisible();
  await expect(drawer.getByText('feat/group-order-summary')).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Definition of done' })).toBeVisible();
});

test('the palette finds a ticket by key from anywhere and opens it', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await dialog.getByRole('combobox').fill('FOOD-ENG-8');
  await dialog.getByRole('option', { name: /FOOD-ENG-8/ }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Group order summary page');
});
