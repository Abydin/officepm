import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('the project page lists links and leads to Docs & Files from the sidebar too', async ({
  page,
}) => {
  await page.goto('/#/projects/food');
  const docs = page.getByRole('region', { name: 'Docs & Links' });
  await expect(docs.getByRole('link', { name: /Ordering API reference/ })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Projects and boards' })
    .getByRole('link', { name: 'Docs & Files' })
    .first()
    .click();
  await expect(page).toHaveURL(/projects\/food\/docs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Docs & Files' })).toBeVisible();
});

test('adds a link, refuses a bad address with the server message, and deletes it after confirming', async ({
  page,
}) => {
  await page.goto('/#/projects/food/docs');
  await page.getByLabel('Link title').fill('E2E runbook');
  await page.getByLabel('Link URL').fill('ftp://example.com/runbook');
  await page.getByRole('button', { name: 'Add link' }).click();
  await expect(page.getByRole('alert')).toContainText('url must be http: or https:');

  await page.getByLabel('Link URL').fill('https://example.com/runbook');
  await page.getByRole('button', { name: 'Add link' }).click();
  const links = page.getByRole('region', { name: 'Links' });
  const link = links.getByRole('link', { name: /E2E runbook/ });
  await expect(link).toHaveAttribute('href', 'https://example.com/runbook');
  await expect(link).toHaveAttribute('target', '_blank');

  await links.getByRole('button', { name: 'Delete E2E runbook' }).click();
  await links.getByRole('button', { name: 'Keep it' }).click();
  await expect(link).toBeVisible();
  await links.getByRole('button', { name: 'Delete E2E runbook' }).click();
  await links.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(link).toHaveCount(0);
});

test('uploads a file, downloads it as an attachment, refuses a blocked type, and deletes it', async ({
  page,
}) => {
  await page.goto('/#/projects/food/docs');
  const files = page.getByRole('region', { name: 'Files' });

  await page
    .getByLabel('Project file')
    .setInputFiles({ name: 'e2e-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  const row = files.getByRole('listitem').filter({ hasText: 'e2e-notes.txt' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Maya Okafor');

  const download = page.waitForEvent('download');
  await row.getByRole('link', { name: 'Download e2e-notes.txt' }).click();
  expect((await download).suggestedFilename()).toBe('e2e-notes.txt');

  await page
    .getByLabel('Project file')
    .setInputFiles({ name: 'run.sh', mimeType: 'text/plain', buffer: Buffer.from('echo') });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(files.getByRole('listitem').filter({ hasText: 'run.sh' })).toHaveCount(0);

  await row.getByRole('button', { name: 'Delete e2e-notes.txt' }).click();
  await row.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(row).toHaveCount(0);
});
