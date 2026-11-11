import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('lists the seeded epics with progress, and opens one from the keyboard', async ({ page }) => {
  await page.goto('/#/projects/food/boards/eng');
  await page.getByRole('link', { name: 'Epics' }).click();
  await expect(page).toHaveURL(/boards\/eng\/epics$/);

  for (const title of ['Group ordering', 'Payments and receipts', 'Kitchen dashboard']) {
    await expect(page.getByRole('region', { name: new RegExp(title) })).toBeVisible();
  }
  const payments = page.getByRole('region', { name: /Payments and receipts/ });
  await expect(payments).toContainText(/\d+ of \d+ done/);
  await expect(payments.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^\d+$/);

  await payments.getByRole('button', { name: /Payments and receipts/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue(
    'Payments and receipts',
  );
});

test('an epic lists its tickets', async ({ page }) => {
  await page.goto('/#/projects/food/boards/eng/epics');
  const group = page.getByRole('region', { name: /Group ordering/ });
  await group.getByText(/tickets in this epic/).click();
  await expect(group.getByText('Group order summary page')).toBeVisible();
});

test('a Kanban board without the agile layer has no Epics tab', async ({ page }) => {
  await page.goto('/#/projects/food/boards/design');
  await expect(page.getByRole('link', { name: 'Epics' })).toHaveCount(0);
});
