import { expect, test } from '@playwright/test';
import { SAM, signIn } from './helpers';

test('an admin lists users, creates one, resets their password, and the new password works', async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Projects and boards' })
    .getByRole('link', { name: 'Admin' })
    .click();
  await expect(page).toHaveURL(/#\/admin$/);

  const users = page.getByRole('table', { name: 'Users' });
  await expect(users.getByRole('row', { name: /maya.okafor@officepm.demo/ })).toContainText(
    'Admin',
  );
  await expect(users.getByRole('row', { name: /sam.adeyemi@officepm.demo/ })).not.toContainText(
    'Admin',
  );
  await expect(page.getByRole('table', { name: 'Boards' })).toContainText('FOOD-ENG');

  const email = `e2e.${Date.now()}@officepm.demo`;
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Name', { exact: true }).fill('E2E Person');
  await page.getByLabel('Password', { exact: true }).fill('first-pass');
  await page.getByLabel('Admin', { exact: true }).check();
  await page.getByRole('button', { name: 'Create user' }).click();
  const row = users.getByRole('row', { name: new RegExp(email.replace(/\./g, '\\.')) });
  await expect(row).toContainText('Admin');
  await expect(page.getByRole('status')).toContainText('Created E2E Person.');

  // A duplicate is refused with the server's message.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Name', { exact: true }).fill('Again');
  await page.getByLabel('Password', { exact: true }).fill('first-pass');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('alert')).toContainText('already exists');

  // Reset in the dialog, by keyboard: the password box has focus on open, Escape cancels.
  await row.getByRole('button', { name: 'Reset password for E2E Person' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset password for E2E Person' });
  await expect(dialog.getByLabel('New password')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await row.getByRole('button', { name: 'Reset password for E2E Person' }).click();
  await dialog.getByLabel('New password').fill('abc');
  await expect(dialog.getByRole('button', { name: 'Reset password' })).toBeDisabled();
  await dialog.getByLabel('New password').fill('second-pass');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Password reset for E2E Person.');

  // The server really changed it: the old password fails and the new one signs in.
  const other = await browser.newContext();
  const oldTry = await other.request.post('/api/login', {
    data: { email, password: 'first-pass' },
  });
  expect(oldTry.status()).toBe(401);
  const newTry = await other.request.post('/api/login', {
    data: { email, password: 'second-pass' },
  });
  expect(newTry.status()).toBe(200);
  await other.close();
});

test('someone who is not an admin has no Admin link and is told so at the address', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, SAM);
  await expect(
    page
      .getByRole('navigation', { name: 'Projects and boards' })
      .getByRole('link', { name: 'Admin' }),
  ).toHaveCount(0);
  await page.goto('/#/admin');
  await expect(page.getByText('Admins only')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Users' })).toHaveCount(0);

  // And the server agrees, whatever the client does.
  expect((await context.request.get('/api/users')).status()).toBe(403);
  await context.close();
});
