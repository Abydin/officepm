import { expect, test } from '@playwright/test';

// Demo login created by the v2 demo seeder (apps/server/src/seed), which e2e/serve.mjs runs.
const DEMO = { email: 'maya.okafor@officepm.demo', password: 'demo-password' };

test('signs in against the seeded server and shows the overview', async ({ page }) => {
  await page.goto('/');
  // The auth gate sends an anonymous visitor to the login page.
  await expect(page).toHaveURL(/#\/login$/);

  await page.getByLabel('Email').fill(DEMO.email);
  await page.getByLabel('Password').fill(DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/#\/overview$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  // Seeded data reached the page: the stat cards and the sidebar's project list.
  await expect(page.getByText('Finished in the last 7 days')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Projects and boards' }).getByText('Food'),
  ).toBeVisible();
});

test('a first visit leaves the browser console clean: no 401 for the session probe', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(msg.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  const failed: string[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${new URL(res.url()).pathname}`);
  });

  await page.goto('/');
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(failed).toEqual([]);
  expect(problems).toEqual([]);
});
