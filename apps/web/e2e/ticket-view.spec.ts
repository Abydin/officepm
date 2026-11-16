import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { removeTickets, showProperty, signIn } from './helpers';

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

const drawerOf = (page: Page) => page.getByRole('dialog', { name: /^Ticket / });

async function make(page: Page, data: Record<string, unknown>) {
  const res = await page.request.post('/api/tickets', {
    data: { project_slug: 'food', board_slug: 'eng', status: 'Backlog', ...data },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { key: string }).key;
}

const made: string[] = [];
test.afterEach(async ({ page }) => {
  for (const key of made.splice(0)) await page.request.delete(`/api/tickets/${key}`);
});

test.describe('the ticket view', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('puts the description above the fold and above the properties on a fresh story', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const key = await make(page, { type: 'story', level: 'story', title: 'View: fresh story' });
    made.push(key);
    await page.goto(`/#/projects/food/boards/eng?t=${key}`);
    const drawer = drawerOf(page);
    const description = drawer.getByLabel('Description');
    await expect(description).toBeInViewport({ ratio: 1 });
    // A string, because the e2e project's TypeScript has no DOM types to check a page function against.
    const inOrder = await page.evaluate(`(() => {
      const el = document.querySelector('[role="dialog"]');
      const d = el.querySelector('textarea');
      const status = [...el.querySelectorAll('select')].find((s) =>
        (s.labels[0]?.textContent || '').includes('Status'),
      );
      return Boolean(d.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING);
    })()`);
    expect(inOrder).toBe(true);
    // Empty properties are not on screen.
    for (const name of ['Priority', 'Due date', 'Points']) {
      await expect(drawer.getByLabel(name)).toHaveCount(0);
    }
  });

  test('counts the interactive controls on a fresh story', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const key = await make(page, { type: 'story', level: 'story', title: 'View: count' });
    made.push(key);
    await page.goto(`/#/projects/food/boards/eng?t=${key}`);
    await expect(drawerOf(page).getByLabel('Title', { exact: true })).toBeVisible();
    const count = (await page.evaluate(`(() => {
      const el = document.querySelector('[role="dialog"]');
      return [...el.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex="0"]')].filter(
        (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && e.type !== 'hidden',
      ).length;
    })()`)) as number;
    console.log(`interactive controls on a fresh story: ${count}`);
    // Before this layout: 31 measured in the same way.
    expect(count).toBeLessThan(31);
  });

  test('an empty property is hidden, and adding one reveals it and saves it', async ({ page }) => {
    const key = await make(page, { type: 'task', title: 'View: add property' });
    made.push(key);
    await page.goto(`/#/projects/food/boards/eng?t=${key}`);
    const drawer = drawerOf(page);
    const priority = drawer.getByLabel('Priority');
    await expect(priority).toHaveCount(0);
    await showProperty(page, drawer, 'Priority', priority);
    await priority.selectOption('high');
    await expect
      .poll(async () => (await (await page.request.get(`/api/tickets/${key}`)).json()).priority)
      .toBe('high');
    await page.reload();
    await expect(drawerOf(page).getByLabel('Priority')).toHaveValue('high');
  });

  test('full page survives a reload, F toggles it, and Back closes it', async ({ page }) => {
    const key = await make(page, { type: 'task', title: 'View: full page' });
    made.push(key);
    await page.goto('/#/projects/food/boards/eng');
    await page.locator(`[data-ticket-key="${key}"]`).click();
    const drawer = drawerOf(page);
    await expect(drawer.getByLabel('Title', { exact: true })).toBeVisible();
    await drawer.focus();
    await page.keyboard.press('f');
    await expect(page).toHaveURL(/full=1/);
    await expect(drawer.getByRole('button', { name: 'Back to side panel' })).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);

    await page.reload();
    await expect(drawerOf(page).getByRole('button', { name: 'Back to side panel' })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(/t=/);
  });

  test('F toggles back to the side panel', async ({ page }) => {
    const key = await make(page, { type: 'task', title: 'View: toggle' });
    made.push(key);
    await page.goto(`/#/projects/food/boards/eng?t=${key}&full=1`);
    const drawer = drawerOf(page);
    await expect(drawer.getByRole('button', { name: 'Back to side panel' })).toBeVisible();
    await drawer.focus();
    await page.keyboard.press('f');
    await expect(page).not.toHaveURL(/full=1/);
    await expect(drawer.getByRole('button', { name: 'Open full page' })).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(760);
  });

  test('a 390px drawer has no horizontal overflow, and folds properties away', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const key = await make(page, {
      type: 'story',
      level: 'story',
      title: 'View: phone',
      priority: 'high',
    });
    made.push(key);
    await page.goto(`/#/projects/food/boards/eng?t=${key}`);
    const drawer = drawerOf(page);
    await expect(drawer.getByLabel('Title', { exact: true })).toBeVisible();
    await expect(drawer.getByLabel('Status')).toBeVisible();
    await expect(drawer.getByLabel('Priority')).toBeHidden();
    await drawer.getByRole('button', { name: /^Properties \(/ }).click();
    await expect(drawer.getByLabel('Priority')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Open full page' })).toBeHidden();
    const overflow = await drawer.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('deletes through the more-actions menu, after a confirmation', async ({ page }) => {
    const key = await make(page, { type: 'task', title: 'View: delete me' });
    await page.goto(`/#/projects/food/boards/eng?t=${key}`);
    const drawer = drawerOf(page);
    await expect(drawer.getByRole('button', { name: /Delete/ })).toHaveCount(0);
    await drawer.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Delete ticket' }).click();
    await expect(drawer.getByText(`Delete ${key}?`)).toBeVisible();
    await drawer.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.request.get(`/api/tickets/${key}`)).status()).toBe(404);
  });
});

for (const theme of ['dark', 'light'] as const) {
  test.describe(`ticket view screens, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((t) => localStorage.setItem('pm_theme', t), theme);
      await signIn(page);
    });

    test('drawer, full page and the open Add-property picker', async ({ page }) => {
      await page.goto('/#/t/FOOD-ENG-8');
      const drawer = drawerOf(page);
      await expect(drawer.getByLabel('Title', { exact: true })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await drawer.getByRole('button', { name: 'Add property' }).click();
      await expect(page.getByRole('combobox', { name: 'Find a property' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press('Escape');

      await drawer.getByRole('button', { name: 'Open full page' }).click();
      await expect(drawer.getByRole('button', { name: 'Back to side panel' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('the 390px drawer', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto('/#/t/FOOD-ENG-8');
      const drawer = drawerOf(page);
      await expect(drawer.getByLabel('Title', { exact: true })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await drawer.getByRole('button', { name: /^Properties \(/ }).click();
      expect(await violations(page)).toEqual([]);
    });

    test('an epic with a pipeline, and a ticket with a blocked banner', async ({ page }) => {
      const epic = await make(page, { type: 'epic', level: 'epic', title: `View epic ${theme}` });
      const blocked = await make(page, {
        type: 'task',
        level: 'task',
        title: `View blocked ${theme}`,
      });
      made.push(epic, blocked);
      const patched = await page.request.patch(`/api/tickets/${blocked}`, {
        data: { blocked: true, blocker_reason: 'Waiting on the payments API' },
      });
      expect(patched.status()).toBe(200);

      await page.goto(`/#/projects/food/boards/eng/epics?t=${epic}`);
      const start = drawerOf(page).getByRole('button', { name: 'Start pipeline' });
      await expect(start).toBeVisible();
      await start.click();
      await expect(drawerOf(page).getByRole('button', { name: 'Move feature' })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.goto(`/#/projects/food/boards/eng?t=${blocked}`);
      const banner = drawerOf(page).getByRole('region', { name: 'Blocked' });
      await expect(banner.getByRole('textbox')).toHaveValue('Waiting on the payments API');
      expect(await violations(page)).toEqual([]);
    });
  });
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await removeTickets(page, []);
  await page.close();
});
