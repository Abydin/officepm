import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// A phone. The board columns may scroll inside their own strip; the page may not.
test.use({ viewport: { width: 390, height: 800 } });

const pageScrollsSideways = (page: Page) =>
  page.locator('html').evaluate((el) => el.scrollWidth > el.clientWidth);

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('a Scrum board and a Waterfall board do not scroll the page sideways', async ({ page }) => {
  for (const board of ['food/boards/eng', 'acme/boards/eng']) {
    await page.goto(`/#/projects/${board}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-ticket-key]').first()).toBeVisible();
    expect(await pageScrollsSideways(page), board).toBe(false);
  }
});

test('the columns still scroll inside their own strip', async ({ page }) => {
  await page.goto('/#/projects/food/boards/eng');
  const strip = page.locator('div.snap-x');
  await expect(strip).toBeVisible();
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('My Tickets shows every column without a sideways scroll', async ({ page }) => {
  await page.goto('/#/mine');
  const table = page.getByRole('table', { name: 'Assigned to you' });
  await expect(table).toBeVisible();
  const clipped = await table.evaluate((el) => {
    const wrap = el.parentElement!;
    return {
      table: el.scrollWidth,
      wrap: wrap.clientWidth,
      scrolls: wrap.scrollWidth > wrap.clientWidth,
    };
  });
  expect(clipped.scrolls, JSON.stringify(clipped)).toBe(false);
  // The Board and Due columns fold into the title cell on a phone, so no column is cut off
  // and the board name is still on screen in every row.
  for (const name of ['Key', 'Title', 'Status']) {
    const box = await table.getByRole('columnheader', { name }).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.x + box!.width, name).toBeLessThanOrEqual(390);
  }
  const firstRow = table.getByRole('row').nth(1);
  const boardName = firstRow
    .locator('span:not(:has(span))')
    .filter({ hasText: /^[\w-]+\/[\w-]+$/ });
  await expect(boardName).toBeVisible();
  const board = await boardName.boundingBox();
  expect(board!.x + board!.width).toBeLessThanOrEqual(390);
  expect(await pageScrollsSideways(page)).toBe(false);
});
