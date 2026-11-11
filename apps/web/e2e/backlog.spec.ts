import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const eng = '/#/projects/food/boards/eng';

test('shows the seeded sprints, the active one with its burndown, and the unscheduled tickets', async ({
  page,
}) => {
  await page.goto(`${eng}/backlog`);
  await expect(page.getByRole('link', { name: 'Backlog' })).toHaveAttribute('aria-current', 'page');

  const active = page.getByRole('region', { name: 'Sprint 14' });
  await expect(active).toContainText('active');
  await expect(active.getByRole('button', { name: 'Mark completed' })).toBeVisible();
  await expect(active.getByRole('img', { name: /Sprint burndown/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sprint 13' })).toContainText('completed');
  await expect(
    page.getByRole('heading', { name: 'Unscheduled backlog (5 · 11 pt)' }),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /Order history filters/ })).toBeVisible();
});

test('plans a sprint end to end: create, move tickets in and out, and meet the Definition of Ready gate', async ({
  page,
}) => {
  await page.goto(`${eng}/backlog`);

  await page.getByLabel('Sprint name').fill('E2E Sprint');
  await expect(page.getByLabel('End date')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Create sprint' }).click();
  const planned = page.getByRole('region', { name: 'E2E Sprint' });
  await expect(planned).toContainText('planned');
  await expect(planned).toContainText('0 tickets');

  // Move an unscheduled ticket into it, with the select, then back out.
  const row = page.getByRole('row', { name: /Order history filters/ });
  await row.getByRole('combobox').selectOption({ label: 'E2E Sprint' });
  await expect(planned).toContainText('1 ticket');
  await expect(page.getByRole('row', { name: /Order history filters/ })).toHaveCount(0);
  await planned.getByRole('combobox', { name: /^Move FOOD-ENG-/ }).selectOption({
    label: 'Back to the backlog',
  });
  await expect(planned).toContainText('0 tickets');
  await expect(page.getByRole('row', { name: /Order history filters/ })).toBeVisible();

  // The gate, by keyboard only: Enter opens it, Space ticks each item.
  await planned.getByRole('button', { name: 'Activate' }).focus();
  await page.keyboard.press('Enter');
  const confirm = planned.getByRole('button', { name: 'Confirm activate' });
  await expect(confirm).toBeDisabled();
  const items = planned.getByRole('checkbox');
  await expect(items).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await items.nth(i).focus();
    await page.keyboard.press('Space');
  }
  await expect(confirm).toBeEnabled();

  // Sprint 14 is still active, so the server refuses, and says why.
  await confirm.click();
  await expect(planned.getByRole('alert')).toContainText('already active');
});

test('activates and completes a sprint on a board with no Definition of Ready, and reaches its retro', async ({
  page,
}) => {
  await page.goto('/#/projects/food/boards/support/backlog');
  await expect(page.getByRole('region', { name: 'Velocity' })).toContainText(/Average|Not enough/);

  await page.getByLabel('Sprint name').fill('E2E Week');
  await page.getByRole('button', { name: 'Create sprint' }).click();
  const sprint = page.getByRole('region', { name: 'E2E Week' });
  await sprint.getByRole('button', { name: 'Activate' }).click();
  await expect(sprint.getByText('No Definition of Ready is set for this board.')).toBeVisible();
  await sprint.getByRole('button', { name: 'Confirm activate' }).click();
  await expect(sprint).toContainText('active');

  await sprint.getByRole('button', { name: 'Mark completed' }).click();
  await expect(sprint).toContainText('completed');
  // Completing makes the server create the retro; it appears without a reload.
  await sprint.getByRole('link', { name: 'View retro' }).click();
  await expect(page).toHaveURL(/boards\/support\/retros\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'E2E Week Retro' })).toBeVisible();
});

test('Shape Up offers cycles and cooldowns, with a six week default', async ({ page }) => {
  await page.goto('/#/projects/northwind/boards/product/backlog');
  await expect(page.getByRole('heading', { name: 'Cycles' })).toBeVisible();
  await page.getByLabel('Start date').fill('2030-01-07');
  await expect(page.getByLabel('End date')).toHaveValue('2030-02-18');
  await page.getByLabel('Cycle name').fill('E2E Cycle');
  await page.getByRole('button', { name: 'Create cycle' }).click();
  const cycle = page.getByRole('region', { name: 'E2E Cycle' });
  await expect(cycle).toContainText('2030-01-07 to 2030-02-18');

  await page.getByLabel('Kind').selectOption('cooldown');
  await expect(page.getByLabel('End date')).toHaveValue('2030-01-21');
});
