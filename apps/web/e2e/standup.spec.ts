import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('groups the board by person with status and blockers, and opens a ticket by keyboard', async ({
  page,
}) => {
  await page.goto('/#/projects/food/boards/eng');
  await page.getByRole('link', { name: 'Standup' }).click();
  await expect(page).toHaveURL(/boards\/eng\/standup$/);

  const maya = page.getByRole('region', { name: 'Maya Okafor' });
  await expect(maya).toBeVisible();
  await expect(maya).toContainText('Blocked: Waiting on the printer SDK licence from the vendor');
  await expect(page.getByRole('region', { name: 'Unassigned' })).toContainText(
    'Order history filters',
  );
  // People by name, the unassigned last.
  const names = await page.getByRole('heading', { level: 2 }).allTextContents();
  expect(names.at(-1)).toBe('Unassigned');
  expect(names.slice(0, -1)).toEqual([...names.slice(0, -1)].sort());

  await maya.getByRole('button', { name: /Group order summary page/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue(
    'Group order summary page',
  );
});
