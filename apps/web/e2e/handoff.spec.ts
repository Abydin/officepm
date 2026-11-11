import { expect, test, type Browser, type Page } from '@playwright/test';
import { card, column, dragCard, SAM, signIn } from './helpers';

const TUNDE = { email: 'tunde.bakare@officepm.demo', password: 'demo-password' };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A ticket of its own per test, so the tests do not depend on each other or on the seed. */
async function newTicket(page: Page, title: string, status: string, board = 'design') {
  const res = await page.request.post('/api/tickets', {
    data: { project_slug: 'food', board_slug: board, title, type: 'task', status },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { key: string }).key;
}

/** Departments for the people the demo seed made (admin only, so call it as Maya). */
async function setDepartments(page: Page) {
  const users = (await (await page.request.get('/api/users')).json()) as Array<{
    id: number;
    email: string;
  }>;
  const wanted: Record<string, string> = {
    'maya.okafor@officepm.demo': 'Design',
    'sam.adeyemi@officepm.demo': 'Engineering',
    'tunde.bakare@officepm.demo': 'Engineering',
    'priya.nair@officepm.demo': 'Product',
  };
  for (const u of users) {
    const department = wanted[u.email];
    if (!department) continue;
    const res = await page.request.patch(`/api/users/${u.id}/department`, { data: { department } });
    expect(res.status()).toBe(200);
  }
}

async function asPerson(browser: Browser, who: { email: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who);
  return { page, context };
}

const moveDialog = (page: Page, key: string) => page.getByRole('dialog', { name: `Move ${key}` });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await setDepartments(page);
});

test('a designer finishes a ticket and hands it to the frontend dev with a note and a screenshot', async ({
  page,
  browser,
}) => {
  const key = await newTicket(page, 'Handoff: checkout mockups', 'In Progress');
  await page.goto('/#/projects/food/boards/design');
  await dragCard(page, key, 'Review');

  const dialog = moveDialog(page, key);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Handoff: checkout mockups')).toBeVisible();
  await expect(dialog.getByTestId('current-status')).toHaveText('In Progress');
  await expect(dialog.getByRole('combobox', { name: 'Move to' })).toHaveValue('Review');

  await dialog
    .getByRole('combobox', { name: 'Hand over to' })
    .selectOption({ label: 'Sam Adeyemi' });
  await dialog
    .getByRole('textbox', { name: /Note/ })
    .fill('Final spacing is in the spec. Screenshot attached.');
  await dialog.getByLabel('Add attachments').setInputFiles({
    name: 'mockup.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(dialog.getByRole('list', { name: 'Attachments to send' })).toContainText(
    'mockup.png',
  );
  await dialog.getByRole('button', { name: 'Approve and move' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(card(column(page, 'Review'), key)).toBeVisible();
  // The sender sees the handoff in the ticket's own history, with the file attached.
  await card(page, key).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('button', { name: /^Assignee: Sam Adeyemi/ })).toBeVisible();
  await expect(drawer.getByText('Handoff', { exact: true })).toBeVisible();
  await expect(drawer.getByText(/Handed off from In Progress to Review/)).toBeVisible();
  await expect(drawer.getByText('Final spacing is in the spec')).toBeVisible();
  await expect(drawer.getByText('Attached: mockup.png')).toBeVisible();
  await expect(drawer.getByRole('link', { name: /mockup\.png/ })).toBeVisible();

  // The recipient is told: a count in the sidebar and top bar, and the note under My Tickets.
  const sam = await asPerson(browser, SAM);
  await expect(sam.page.getByRole('link', { name: /^\d+ unread handoffs?$/ })).toBeVisible();
  await sam.page.goto('/#/mine');
  const inbox = sam.page.getByRole('region', { name: 'Handed to you' });
  await expect(inbox).toContainText('Maya Okafor');
  await expect(inbox).toContainText(key);
  await expect(inbox).toContainText('Final spacing is in the spec');
  await expect(sam.page.getByRole('row', { name: new RegExp(key) })).toBeVisible();

  // Opening the ticket reads it.
  await inbox.getByRole('button', { name: `Open ${key}` }).click();
  await expect(sam.page.getByRole('dialog')).toBeVisible();
  await expect(sam.page.getByRole('region', { name: 'Handed to you' }).getByText(key)).toHaveCount(
    0,
  );
  await sam.context.close();
});

test('the recipient sees a handoff appear live, without reloading', async ({ page, browser }) => {
  const tunde = await asPerson(browser, TUNDE);
  await tunde.page.goto('/#/mine');
  await expect(tunde.page.getByRole('heading', { level: 1, name: 'My Tickets' })).toBeVisible();

  const key = await newTicket(page, 'Handoff: live nudge', 'In Progress');
  await page.goto(`/#/projects/food/boards/design?t=${key}`);
  await page.getByRole('dialog').getByLabel('Status').selectOption('Review');
  const dialog = moveDialog(page, key);
  await dialog
    .getByRole('combobox', { name: 'Hand over to' })
    .selectOption({ label: 'Tunde Bakare' });
  await dialog.getByRole('textbox', { name: /Note/ }).fill('Live nudge note');
  await dialog.getByRole('button', { name: 'Approve and move' }).click();
  await expect(dialog).toHaveCount(0);

  // No navigation on Tunde's side: the event stream brings it.
  await expect(tunde.page.getByRole('region', { name: 'Handed to you' })).toContainText(
    'Live nudge note',
  );
  await tunde.context.close();
});

test('rejecting needs a reason, and sends the ticket back to the chosen earlier stage', async ({
  page,
}) => {
  const key = await newTicket(page, 'Handoff: reject me', 'Review');
  await page.goto('/#/projects/food/boards/design');
  await dragCard(page, key, 'Done');
  const dialog = moveDialog(page, key);
  await expect(dialog.getByRole('combobox', { name: 'Move to' })).toHaveValue('Done');

  await dialog.getByRole('radio', { name: /Reject/ }).check();
  await expect(dialog.getByRole('combobox', { name: 'Move to' })).toHaveValue('In Progress');
  const send = dialog.getByRole('button', { name: 'Send back' });
  await expect(send).toBeDisabled();

  await dialog.getByRole('combobox', { name: 'Move to' }).selectOption('Backlog');
  await dialog.getByRole('textbox', { name: /Reason/ }).fill('Wrong brand colours');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(dialog).toHaveCount(0);

  await expect(card(column(page, 'Backlog'), key)).toBeVisible();
  await card(page, key).click();
  await expect(
    page.getByRole('dialog').getByText(/Sent back from Review to Backlog/),
  ).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Reason: Wrong brand colours')).toBeVisible();
});

test('cancel closes the dialog and the dragged card snaps back, on screen and on the server', async ({
  page,
}) => {
  const key = await newTicket(page, 'Handoff: stay put', 'In Progress');
  await page.goto('/#/projects/food/boards/design');
  await dragCard(page, key, 'Done');
  const dialog = moveDialog(page, key);
  await expect(dialog).toBeVisible();
  // Not moved while the question is open (a modal hides the board from role queries, so use CSS).
  await expect(
    page.locator(`section[aria-label="In Progress"] [data-ticket-key="${key}"]`),
  ).toBeAttached();
  await expect(page.locator(`section[aria-label="Done"] [data-ticket-key="${key}"]`)).toHaveCount(
    0,
  );

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(column(page, 'In Progress'), key)).toBeVisible();
  await expect(card(column(page, 'Done'), key)).toHaveCount(0);

  // Escape does the same.
  await dragCard(page, key, 'Review');
  await expect(moveDialog(page, key)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(moveDialog(page, key)).toHaveCount(0);

  await page.reload();
  await expect(card(column(page, 'In Progress'), key)).toBeVisible();
  const ticket = (await (await page.request.get(`/api/tickets/${key}`)).json()) as {
    status: string;
  };
  expect(ticket.status).toBe('In Progress');
});

test('the department narrows the people, and a department-only handoff reaches all of it', async ({
  page,
  browser,
}) => {
  const key = await newTicket(page, 'Handoff: to engineering', 'In Progress');
  await page.goto(`/#/projects/food/boards/design?t=${key}`);
  await page.getByRole('dialog').getByLabel('Status').selectOption('Review');
  const dialog = moveDialog(page, key);

  await dialog.getByRole('combobox', { name: 'Department' }).selectOption('Engineering');
  await expect(dialog.getByRole('combobox', { name: 'Hand over to' }).locator('option')).toHaveText(
    ['Anyone in Engineering', 'Sam Adeyemi', 'Tunde Bakare'],
  );
  await dialog.getByRole('textbox', { name: /Note/ }).fill('Anyone in engineering can take this');
  await dialog.getByRole('button', { name: 'Approve and move' }).click();
  await expect(dialog).toHaveCount(0);

  const ticket = (await (await page.request.get(`/api/tickets/${key}`)).json()) as {
    assignee: string | null;
    status: string;
  };
  expect(ticket).toMatchObject({ status: 'Review', assignee: null });

  for (const who of [SAM, TUNDE]) {
    const person = await asPerson(browser, who);
    await person.page.goto('/#/mine');
    await expect(person.page.getByRole('region', { name: 'Handed to you' })).toContainText(
      'Anyone in engineering can take this',
    );
    await person.context.close();
  }
  // Someone outside the department is not told.
  await page.goto('/#/mine');
  await expect(page.getByRole('heading', { level: 1, name: 'My Tickets' })).toBeVisible();
  await expect(page.getByText('Anyone in engineering can take this')).toHaveCount(0);
});

test('a pasted screenshot becomes an attachment, and the blocklist still applies', async ({
  page,
}) => {
  const key = await newTicket(page, 'Handoff: paste', 'Backlog');
  await page.goto(`/#/projects/food/boards/design?t=${key}`);
  await page.getByRole('dialog').getByLabel('Status').selectOption('In Progress');
  const dialog = moveDialog(page, key);

  await dialog.getByRole('textbox', { name: /Note/ }).focus();
  // A string, because the e2e project's TypeScript has no DOM types to check a page function against.
  await page.evaluate(`(() => {
    const data = new DataTransfer();
    data.items.add(new File(['x'], 'image.png', { type: 'image/png' }));
    document.activeElement.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  })()`);
  const list = dialog.getByRole('list', { name: 'Attachments to send' });
  await expect(list).toContainText('pasted-image-1.png');

  await dialog.getByLabel('Add attachments').setInputFiles({
    name: 'run.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('MZ'),
  });
  await dialog.getByRole('button', { name: 'Approve and move' }).click();
  await expect(dialog.getByRole('alert')).toContainText('file type .exe is not allowed');
  // Nothing moved, and the screenshot that did upload was taken off the ticket again.
  const ticket = (await (await page.request.get(`/api/tickets/${key}`)).json()) as {
    status: string;
  };
  expect(ticket.status).toBe('Backlog');
  const files = (await (await page.request.get(`/api/tickets/${key}/files`)).json()) as unknown[];
  expect(files).toEqual([]);

  await dialog.getByRole('button', { name: 'Remove run.exe' }).click();
  await dialog.getByRole('button', { name: 'Approve and move' }).click();
  await expect(dialog).toHaveCount(0);
  const after = (await (await page.request.get(`/api/tickets/${key}/files`)).json()) as Array<{
    original_name: string;
  }>;
  expect(after.map((f) => f.original_name)).toEqual(['pasted-image-1.png']);
});

test('the dialog traps focus, is operable from the keyboard alone and fits a phone', async ({
  page,
}) => {
  const key = await newTicket(page, 'Handoff: keyboard', 'In Progress');
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(`/#/projects/food/boards/design?t=${key}`);
  await page.getByRole('dialog').getByLabel('Status').selectOption('Review');
  const dialog = moveDialog(page, key);
  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);

  // Tab never leaves the dialog, in either direction.
  for (const key_ of [...Array(25).fill('Tab'), ...Array(25).fill('Shift+Tab')]) {
    await page.keyboard.press(key_);
    await expect(dialog.locator(':focus')).toHaveCount(1);
  }

  // Reject with the keyboard: pick the radio, type the reason, press the button.
  await dialog.getByRole('radio', { name: /Reject/ }).focus();
  await page.keyboard.press('Space');
  await dialog.getByRole('textbox', { name: /Reason/ }).fill('Needs another pass');
  const send = dialog.getByRole('button', { name: 'Send back' });
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeInViewport();
  await send.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  const ticket = (await (await page.request.get(`/api/tickets/${key}`)).json()) as {
    status: string;
  };
  expect(ticket.status).toBe('Backlog');
});
