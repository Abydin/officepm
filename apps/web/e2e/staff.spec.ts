import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { signIn } from './helpers';

// These specs share one database with the rest of the suite, so every account here is made by the
// spec itself, with a unique email, and nothing here touches the seeded people.
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'e2e-chosen-password';

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target.join(' ')),
  }));
}

/** Makes an invite through the API and returns its token. */
async function inviteToken(page: Page, email: string, name: string): Promise<string> {
  const res = await page.request.post('/api/invites', { data: { email, name } });
  expect(res.status()).toBe(201);
  const { link } = (await res.json()) as { link: string };
  return link.split('/#/invite/')[1]!;
}

/** A signed-in browser context for a brand new person, made through an invite. */
async function newPerson(browser: Browser, admin: Page, email: string, name: string) {
  const token = await inviteToken(admin, email, name);
  const context = await browser.newContext();
  const accepted = await context.request.post(`/api/invites/${token}/accept`, {
    data: { password: PASSWORD },
  });
  expect(accepted.status()).toBe(201);
  return context;
}

test('an admin invites someone, who opens the link, chooses a password and is signed in; the link then stops working', async ({
  page,
  browser,
}) => {
  const email = `invitee.${stamp()}@officepm.demo`;
  await signIn(page);
  await page.goto('/#/admin');
  await page.getByLabel('Invitee address').fill(email);
  await page.getByLabel('Invitee name').fill('E2E Invitee');
  await page.getByRole('button', { name: 'Create invite' }).click();

  const field = page.getByRole('textbox', { name: 'Invite link' });
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  expect(link).toMatch(/#\/invite\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText(/Shown once/)).toBeVisible();

  const person = await browser.newContext();
  const tab = await person.newPage();
  await tab.goto(link);
  await expect(tab.getByRole('heading', { level: 1, name: 'Welcome, E2E Invitee' })).toBeVisible();
  await tab.getByLabel('Password', { exact: true }).fill('short');
  await tab.getByLabel('Confirm password').fill('short');
  await expect(tab.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await tab.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await tab.getByLabel('Confirm password').fill(PASSWORD);
  await tab.getByRole('button', { name: 'Create account' }).click();
  await expect(tab).toHaveURL(/#\/overview$/);
  // They chose the password, so there is no forced change screen.
  await expect(tab.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0);

  // The same link is now dead, and says nothing about why.
  const third = await browser.newContext();
  const dead = await third.newPage();
  await dead.goto(link);
  await expect(
    dead.getByRole('heading', { level: 1, name: 'This invite link does not work' }),
  ).toBeVisible();

  // The admin sees it used, and the person in the Users table.
  await page.reload();
  await expect(
    page
      .getByRole('table', { name: 'Invites' })
      .getByRole('row', { name: new RegExp(email.replace(/\./g, '\\.')) }),
  ).toContainText('used');
  await expect(
    page
      .getByRole('table', { name: 'Users' })
      .getByRole('row', { name: new RegExp(email.replace(/\./g, '\\.')) }),
  ).toContainText('Active');
  await person.close();
  await third.close();
});

test('a person an admin gave a password must choose their own first, and is then in', async ({
  page,
  browser,
}) => {
  const email = `forced.${stamp()}@officepm.demo`;
  await signIn(page);
  const created = await page.request.post('/api/users', {
    data: { email, name: 'E2E Forced', password: 'admin-set-pass' },
  });
  expect(created.status()).toBe(201);

  const person = await browser.newContext();
  const tab = await person.newPage();
  await tab.goto('/');
  await tab.getByLabel('Email').fill(email);
  await tab.getByLabel('Password').fill('admin-set-pass');
  await tab.getByRole('button', { name: 'Sign in' }).click();
  await expect(tab.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeVisible();

  // There is no way around it: another address shows the same screen, and the API refuses.
  await tab.goto('/#/projects');
  await expect(tab.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  const refused = await person.request.get('/api/projects');
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: 'password_change_required' });

  await tab.getByLabel('Current password').fill('admin-set-pass');
  await tab.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await tab.getByLabel('Confirm new password').fill(PASSWORD);
  await tab.getByRole('button', { name: 'Change password' }).click();
  await expect(tab.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
  expect((await person.request.get('/api/projects')).status()).toBe(200);
  await person.close();
});

test('changing your own password signs the other devices out and keeps this one', async ({
  page,
  browser,
}) => {
  const email = `change.${stamp()}@officepm.demo`;
  await signIn(page);
  const here = await newPerson(browser, page, email, 'E2E Changer');
  const there = await browser.newContext();
  expect(
    (await there.request.post('/api/login', { data: { email, password: PASSWORD } })).status(),
  ).toBe(200);

  const tab = await here.newPage();
  await tab.goto('/');
  await tab.getByRole('button', { name: 'Change password' }).click();
  const dialog = tab.getByRole('dialog', { name: 'Change password' });
  await dialog.getByLabel('Current password').fill('wrong-password');
  await dialog.getByLabel('New password', { exact: true }).fill('another-password');
  await dialog.getByLabel('Confirm new password').fill('another-password');
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog.getByRole('alert')).toContainText('current password is incorrect');
  // Still signed in: a wrong current password is not an expired session.
  expect((await here.request.get('/api/me')).status()).toBe(200);

  await dialog.getByLabel('Current password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog).toContainText('signed out everywhere else');
  expect((await here.request.get('/api/me')).status()).toBe(200);
  expect((await there.request.get('/api/me')).status()).toBe(401);
  await here.close();
  await there.close();
});

test('deactivating someone ends their session and blocks sign-in, and reactivating lets them back', async ({
  page,
  browser,
}) => {
  const email = `leaver.${stamp()}@officepm.demo`;
  await signIn(page);
  const person = await newPerson(browser, page, email, 'E2E Leaver');
  expect((await person.request.get('/api/me')).status()).toBe(200);

  await page.goto('/#/admin');
  const row = page
    .getByRole('table', { name: 'Users' })
    .getByRole('row', { name: new RegExp(email.replace(/\./g, '\\.')) });
  await expect(row).toContainText('Active');
  await row.getByRole('button', { name: 'Deactivate E2E Leaver' }).click();
  // A confirm step: nothing has happened yet.
  expect((await person.request.get('/api/me')).status()).toBe(200);
  await row.getByRole('button', { name: 'Yes, deactivate' }).click();
  await expect(row).toContainText('Deactivated');

  expect((await person.request.get('/api/me')).status()).toBe(401);
  const login = await person.request.post('/api/login', { data: { email, password: PASSWORD } });
  expect(login.status()).toBe(401);
  expect(await login.json()).toEqual({ error: 'invalid email or password' });

  // Not offered for new work, still named on what they had.
  const people = (await (await page.request.get('/api/people')).json()) as Array<{ name: string }>;
  expect(people.map((p) => p.name)).not.toContain('E2E Leaver');

  await row.getByRole('button', { name: 'Reactivate E2E Leaver' }).click();
  await row.getByRole('button', { name: 'Yes, reactivate' }).click();
  await expect(row).toContainText('Active');
  expect(
    (await person.request.post('/api/login', { data: { email, password: PASSWORD } })).status(),
  ).toBe(200);

  // And you cannot do it to yourself: the button is not there, and the server agrees.
  const mine = page.getByRole('table', { name: 'Users' }).getByRole('row', { name: /maya.okafor/ });
  await expect(mine.getByRole('button', { name: /^Deactivate/ })).toHaveCount(0);
  expect((await page.request.post('/api/users/1/deactivate')).status()).toBe(409);
  await person.close();
});

test('a CSV import previews, flags problems, makes only the valid invites and downloads the links', async ({
  page,
}) => {
  const good = `csv.${stamp()}@officepm.demo`;
  await signIn(page);
  await page.goto('/#/admin');
  const csv = [
    'email,name,is_admin',
    `${good},"Lovelace, Ada",`,
    'not-an-email,Bad Row,',
    `${good},Twice,`,
  ].join('\n');
  await page.getByLabel('CSV text').fill(csv);
  await page.getByRole('button', { name: 'Preview' }).click();

  const preview = page.getByRole('table', { name: 'Import preview' });
  await expect(preview.getByRole('row', { name: /Lovelace/ })).toContainText('Ready');
  await expect(preview.getByRole('row', { name: /Bad Row/ })).toContainText(
    'Problem: email must be an email address',
  );
  await expect(preview.getByRole('row', { name: /Twice/ })).toContainText('more than once');
  // The preview created nothing.
  const before = (await (await page.request.get('/api/invites')).json()) as Array<{
    email: string;
  }>;
  expect(before.map((i) => i.email)).not.toContain(good);

  await page.getByRole('button', { name: 'Create 1 invite' }).click();
  const results = page.getByRole('table', { name: 'Import results' });
  await expect(results.getByRole('row', { name: /Lovelace/ })).toContainText('Invited');
  const linkText = await results
    .getByRole('row', { name: /Lovelace/ })
    .locator('td')
    .last()
    .innerText();
  expect(linkText).toMatch(/#\/invite\/[A-Za-z0-9_-]{43}$/);

  // The download is built in the page from the server's text and must not trip the CSP.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('officepm-invites.csv');
  const stream = await file.createReadStream();
  let body = '';
  for await (const chunk of stream) body += chunk;
  expect(body.split('\r\n')[0]).toBe('email,name,invite_link');
  expect(body).toContain(`${good},"Lovelace, Ada",`);
  expect(body).toContain(linkText.trim());

  // Only the valid row became an invite, and it is pending.
  const after = (await (await page.request.get('/api/invites')).json()) as Array<{
    email: string;
    status: string;
  }>;
  expect(after.filter((i) => i.email === good)).toEqual([
    expect.objectContaining({ status: 'pending' }),
  ]);
  expect(after.map((i) => i.email)).not.toContain('not-an-email');
});

for (const theme of ['dark', 'light'] as const) {
  test(`the new staff screens have no accessibility violations, ${theme} theme`, async ({
    page,
    browser,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((t) => localStorage.setItem('pm_theme', t), theme);
    await signIn(page);
    const email = `axe.${theme}.${stamp()}@officepm.demo`;

    // Admin with a fresh invite link showing, a preview with a problem row, and the users table.
    await page.goto('/#/admin');
    await page.getByLabel('Invitee address').fill(email);
    await page.getByLabel('Invitee name').fill('Axe Person');
    await page.getByRole('button', { name: 'Create invite' }).click();
    const link = await page.getByRole('textbox', { name: 'Invite link' }).inputValue();
    await page
      .getByLabel('CSV text')
      .fill(`email,name\naxe.csv.${theme}.${stamp()}@officepm.demo,Axe Csv\nbad,Bad`);
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByRole('table', { name: 'Import preview' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Invites' })).toBeVisible();
    expect(await violations(page)).toEqual([]);

    // The change password dialog.
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('dialog', { name: 'Change password' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press('Escape');

    // The public invite screen, then the forced screen right after an admin-set password.
    const context = await browser.newContext();
    await context.addInitScript((t) => localStorage.setItem('pm_theme', t), theme);
    const tab = await context.newPage();
    await tab.emulateMedia({ reducedMotion: 'reduce' });
    await tab.goto(link);
    await expect(tab.getByRole('heading', { level: 1, name: 'Welcome, Axe Person' })).toBeVisible();
    expect(await violations(tab)).toEqual([]);
    await context.close();

    const forcedEmail = `axe.forced.${theme}.${stamp()}@officepm.demo`;
    await page.request.post('/api/users', {
      data: { email: forcedEmail, name: 'Axe Forced', password: 'admin-set-pass' },
    });
    const other = await browser.newContext();
    await other.addInitScript((t) => localStorage.setItem('pm_theme', t), theme);
    const forced = await other.newPage();
    await forced.emulateMedia({ reducedMotion: 'reduce' });
    await forced.goto('/');
    await forced.getByLabel('Email').fill(forcedEmail);
    await forced.getByLabel('Password').fill('admin-set-pass');
    await forced.getByRole('button', { name: 'Sign in' }).click();
    await expect(forced.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    expect(await violations(forced)).toEqual([]);
    await other.close();
  });
}
