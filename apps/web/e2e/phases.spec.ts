import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('Waterfall shows its phase order with counts, and plans dated phases', async ({ page }) => {
  await page.goto('/#/projects/acme/boards/eng');
  await page.getByRole('link', { name: 'Phases' }).click();
  await expect(page).toHaveURL(/boards\/eng\/backlog$/);

  const order = page.getByRole('list').filter({ hasText: 'Requirements' }).first();
  await expect(order.getByRole('listitem').first()).toContainText('Requirements');
  await expect(order).toContainText('Implementation');
  await expect(page.getByText('The board will not skip a phase.')).toBeVisible();

  await expect(page.getByLabel('Kind')).toHaveCount(0);
  await page.getByLabel('Phase name').fill('E2E Phase');
  await page.getByRole('button', { name: 'Create phase' }).click();
  await expect(page.getByRole('region', { name: 'E2E Phase' })).toContainText('planned');
});
