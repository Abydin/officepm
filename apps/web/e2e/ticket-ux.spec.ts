import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

const made: string[] = [];

async function make(page: Page, data: Record<string, unknown>) {
  const res = await page.request.post('/api/tickets', {
    data: { project_slug: 'food', board_slug: 'eng', title: 'UX', type: 'story', ...data },
  });
  expect(res.status()).toBe(201);
  const key = ((await res.json()) as { key: string }).key;
  made.push(key);
  return key;
}

const typeOf = async (page: Page, key: string) =>
  ((await (await page.request.get(`/api/tickets/${key}`)).json()) as { type: string }).type;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  for (const key of made.splice(0)) await page.request.delete(`/api/tickets/${key}`);
});

test('quick-add on Engineering creates a task, not an epic, and opens its drawer', async ({
  page,
}) => {
  await page.goto('/#/projects/food/boards/eng');
  const select = page.getByRole('combobox', { name: 'Ticket type' });
  await expect(select).toHaveValue('task');
  await page.getByLabel('New ticket title').fill('Quick-add default type');
  await page.getByLabel('New ticket title').press('Enter');

  const drawer = page.getByRole('dialog');
  await expect(drawer.getByLabel('Title', { exact: true })).toHaveValue('Quick-add default type');
  const key = new URL(page.url().replace('/#', '')).searchParams.get('t')!;
  made.push(key);
  expect(await typeOf(page, key)).toBe('task');
});

test('the type select creates the type that was picked', async ({ page }) => {
  await page.goto('/#/projects/food/boards/eng');
  await page.getByRole('combobox', { name: 'Ticket type' }).selectOption('bug');
  await page.getByLabel('New ticket title').fill('Quick-add a bug');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue(
    'Quick-add a bug',
  );
  const key = new URL(page.url().replace('/#', '')).searchParams.get('t')!;
  made.push(key);
  expect(await typeOf(page, key)).toBe('bug');
});

test('Enter with no title says so instead of doing nothing', async ({ page }) => {
  await page.goto('/#/projects/food/boards/eng');
  await page.getByLabel('New ticket title').press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Enter a title');
});

test('the sub-ticket box is on a story, and not on an epic or a sub-ticket', async ({ page }) => {
  const epic = await make(page, { type: 'epic', title: 'UX epic' });
  const story = await make(page, { title: 'UX story' });
  const subRes = await page.request.post(`/api/tickets/${story}/subtickets`, {
    data: { title: 'UX child' },
  });
  expect(subRes.status()).toBe(201);
  const child = ((await subRes.json()) as { key: string }).key;
  made.push(child);

  const box = page.getByRole('dialog').getByRole('textbox', { name: 'New sub-ticket title' });

  await page.goto(`/#/projects/food/boards/eng?t=${story}`);
  await expect(box).toBeVisible();

  await page.goto(`/#/projects/food/boards/eng?t=${child}`);
  await expect(
    page.getByRole('dialog').getByText("Sub-tickets can't have their own."),
  ).toBeVisible();
  await expect(box).toHaveCount(0);

  await page.goto(`/#/projects/food/boards/eng?t=${epic}`);
  await expect(
    page.getByRole('dialog').getByText('Create a ticket and set this epic as its Epic.'),
  ).toBeVisible();
  await expect(box).toHaveCount(0);
  // The empty Epic row is not on screen; it is offered under "+ Add property".
  const drawer = page.getByRole('dialog', { name: /^Ticket / });
  await drawer.getByRole('button', { name: 'Add property' }).click();
  await expect(page.getByRole('option', { name: 'Epic', exact: true })).toBeVisible();
});

test('C on Overview opens the palette with an empty filter', async ({ page }) => {
  await page.goto('/#/overview');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('c');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('combobox')).toHaveValue('');
});

for (const theme of ['dark', 'light'] as const) {
  test(`epic drawer and quick-add have no axe violations (${theme})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((t) => localStorage.setItem('pm_theme', t), theme);
    const epic = await make(page, { type: 'epic', title: 'UX axe epic' });
    await page.goto(`/#/projects/food/boards/eng?t=${epic}`);
    await expect(page.getByText('Epics hold tickets.')).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
}
