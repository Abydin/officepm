import { expect, test, type Browser, type Page } from '@playwright/test';
import { card, removeTickets, signIn } from './helpers';

const TUNDE = { email: 'tunde.bakare@officepm.demo', password: 'demo-password' };
const SAM = { email: 'sam.adeyemi@officepm.demo', password: 'demo-password' };

// Backlog, not In Progress: the Design board's In Progress has a WIP limit of 3, and the a11y specs
// check the board in both themes, where an over-limit badge has a contrast problem of its own.
const made: string[] = [];

async function newTicket(page: Page, title: string, status = 'Backlog') {
  const res = await page.request.post('/api/tickets', {
    data: { project_slug: 'food', board_slug: 'design', title, type: 'task', status },
  });
  expect(res.status()).toBe(201);
  const key = ((await res.json()) as { key: string }).key;
  made.push(key);
  return key;
}

async function asPerson(browser: Browser, who: { email: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who);
  return { page, context };
}

async function choosePerson(page: Page, name: string) {
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: /^Person to add/ }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  await removeTickets(page, made.splice(0));
});

test('adds a person with a role in the drawer, sees them on the card, then removes them', async ({
  page,
}) => {
  const key = await newTicket(page, 'People: add and remove');
  await page.goto(`/#/projects/food/boards/design?t=${key}`);
  const drawer = page.getByRole('dialog');
  const people = drawer.getByRole('region', { name: 'People' });
  await expect(people.getByText(/No one else is on this ticket/)).toBeVisible();

  await choosePerson(page, 'Tunde Bakare');
  await people.getByRole('textbox', { name: /Role/ }).fill('Frontend');
  await people.getByRole('button', { name: 'Add person' }).click();
  const list = people.getByRole('list', { name: 'People on this ticket' });
  await expect(list).toContainText('Tunde Bakare');
  await expect(list).toContainText('Frontend');
  // The page the browser received has no email for them.
  await expect(list).not.toContainText('@');

  await choosePerson(page, 'Sam Adeyemi');
  await people.getByRole('button', { name: 'Add person' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);

  await drawer.getByRole('button', { name: 'Close ticket' }).click();
  await expect(drawer).toHaveCount(0);
  const stack = card(page, key).getByTestId('participants');
  await expect(stack.getByRole('img', { name: 'Tunde Bakare' })).toBeVisible();
  await expect(stack.getByRole('img', { name: 'Sam Adeyemi' })).toBeVisible();

  await card(page, key).click();
  await drawer.getByRole('button', { name: 'Remove Tunde Bakare' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).not.toContainText('Tunde Bakare');
});

test('a role over 30 characters cannot be typed and the API refuses one too', async ({ page }) => {
  const key = await newTicket(page, 'People: role limit');
  await page.goto(`/#/projects/food/boards/design?t=${key}`);
  const role = page.getByRole('dialog').getByRole('textbox', { name: /Role/ });
  await role.fill('x'.repeat(45));
  await expect(role).toHaveValue('x'.repeat(30));

  const people = (await (await page.request.get('/api/people')).json()) as Array<{ id: number }>;
  const res = await page.request.post(`/api/tickets/${key}/participants`, {
    data: { user_id: people[0]!.id, role: 'x'.repeat(31) },
  });
  expect(res.status()).toBe(400);
});

test('one handoff nudges two people: each sees it unread, and the second is a participant', async ({
  page,
  browser,
}) => {
  const key = await newTicket(page, 'People: nudge two');
  await page.goto(`/#/projects/food/boards/design?t=${key}`);
  await page.getByRole('dialog').getByLabel('Status').selectOption('Review');
  const dialog = page.getByRole('dialog', { name: `Move ${key}` });
  await dialog
    .getByRole('combobox', { name: 'Hand over to' })
    .selectOption({ label: 'Sam Adeyemi' });
  const also = dialog.getByRole('group', { name: /Also involve/ });
  await expect(also.getByRole('checkbox', { name: /Sam Adeyemi/ })).toHaveCount(0);
  await also.getByRole('checkbox', { name: /Tunde Bakare/ }).check();
  await dialog.getByRole('textbox', { name: /Note/ }).fill('Both of you please look');
  await dialog.getByRole('button', { name: 'Approve and move' }).click();
  await expect(dialog).toHaveCount(0);

  // The primary assignee stays single; the other person is a participant.
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /^Assignee: Sam Adeyemi/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('list', { name: 'People on this ticket' }),
  ).toContainText('Tunde Bakare');

  for (const who of [SAM, TUNDE]) {
    const person = await asPerson(browser, who);
    await expect(person.page.getByRole('link', { name: /^\d+ unread handoffs?$/ })).toBeVisible();
    await person.page.goto('/#/mine');
    const inbox = person.page.getByRole('region', { name: 'Handed to you' });
    await expect(inbox).toContainText(key);
    await expect(inbox).toContainText('Both of you please look');
    if (who === TUNDE) {
      // Not the assignee, so the ticket is listed under Also on, not under assigned to you.
      const also = person.page.getByRole('table', { name: 'Also on' });
      await expect(also.getByRole('row', { name: new RegExp(key) })).toBeVisible();
      await expect(
        person.page
          .getByRole('table', { name: 'Assigned to you' })
          .getByRole('row', { name: new RegExp(key) }),
      ).toHaveCount(0);
    }
    await person.context.close();
  }
});

test('the People section fits a phone without sideways scrolling', async ({ page }) => {
  const key = await newTicket(page, 'People: phone');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/#/projects/food/boards/design?t=${key}`);
  const people = page.getByRole('dialog').getByRole('region', { name: 'People' });
  await people.scrollIntoViewIfNeeded();
  await expect(people.getByRole('button', { name: 'Add person' })).toBeInViewport();
  // The drawer is the thing that must not scroll sideways (the board behind it may).
  const overflow = await page.getByRole('dialog').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await people.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
