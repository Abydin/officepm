import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const sidebar = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Projects and boards' });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('an all-projects view lists every project, and a board lists only its own project', async ({
  page,
}) => {
  const nav = sidebar(page);
  for (const name of ['Food', 'Northwind', 'Acme']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Overview' })).toBeVisible();

  await page.goto('/#/projects/northwind/boards/product');
  await expect(nav.getByRole('link', { name: 'All projects' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Northwind', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Docs & Files' })).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Food', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Acme', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'My Tickets' })).toHaveCount(0);
});

test('the scoped sidebar follows the project through board views, a ticket link and docs', async ({
  page,
}) => {
  const nav = sidebar(page);
  await page.goto('/#/projects/food/boards/eng/standup');
  await expect(nav.getByRole('link', { name: 'Food', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Acme', exact: true })).toHaveCount(0);

  await page.goto('/#/t/FOOD-ENG-8');
  await expect(page.getByRole('dialog')).toBeVisible();
  // The open drawer is modal, so the page behind is hidden from role queries: read the text.
  const behind = page.locator('nav[aria-label="Projects and boards"]');
  await expect(behind).toContainText('All projects');
  await expect(behind).not.toContainText('Acme');

  await page.goto('/#/projects/food/docs');
  await expect(nav.getByRole('link', { name: 'All projects' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Northwind', exact: true })).toHaveCount(0);
});

test('All projects brings the full grouped list back, and works from the keyboard', async ({
  page,
}) => {
  const nav = sidebar(page);
  await page.goto('/#/projects/acme/boards/eng');
  const back = nav.getByRole('link', { name: 'All projects' });
  await back.focus();
  await expect(back).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/projects$/);
  for (const name of ['Food', 'Northwind', 'Acme']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'My Tickets' })).toBeVisible();
});

test('the current board is marked, and the phone nav sheet is scoped the same way', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/#/projects/food/boards/eng');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const sheet = page.getByRole('dialog', { name: 'Navigation' });
  await expect(sheet.getByRole('link', { name: 'Engineering' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sheet.getByRole('link', { name: 'Acme', exact: true })).toHaveCount(0);
  await sheet.getByRole('link', { name: 'All projects' }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(sheet).toHaveCount(0);
});
