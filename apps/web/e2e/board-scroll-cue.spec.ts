import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// A laptop. The six-column Scrum board is wider than the screen, so the page has to say so.
test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const strip = (page: import('@playwright/test').Page) => page.locator('div.snap-x');
const cue = (page: import('@playwright/test').Page, edge: 'left' | 'right') =>
  page.locator(`[data-scroll-cue="${edge}"]`);

test('a board wider than the screen shows an edge fade, and five columns fit whole', async ({
  page,
}) => {
  await page.goto('/#/projects/food/boards/eng');
  await expect(strip(page)).toBeVisible();
  await expect(cue(page, 'right')).toBeVisible();
  await expect(cue(page, 'left')).toHaveCount(0);

  const box = (await strip(page).boundingBox())!;
  const columns = await page
    .locator('div.snap-x > section')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  expect(columns).toHaveLength(6);
  const whole = columns.filter((right) => right <= box.x + box.width + 1).length;
  expect(whole, 'columns that fit whole').toBeGreaterThanOrEqual(5);
  // The sixth column starts on screen, so there is something to pull into view.
  const sixth = await page.locator('div.snap-x > section').nth(5).boundingBox();
  expect(sixth!.x).toBeLessThan(box.x + box.width);
});

test('the fade follows the scroll and is gone at each end', async ({ page }) => {
  await page.goto('/#/projects/food/boards/eng');
  await expect(cue(page, 'right')).toBeVisible();

  await strip(page).evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await expect(cue(page, 'right')).toHaveCount(0);
  await expect(cue(page, 'left')).toBeVisible();
  const done = (await page.getByRole('region', { name: 'Done' }).boundingBox())!;
  expect(done.x).toBeGreaterThanOrEqual(0);
  expect(done.x + done.width, 'Done is fully on screen').toBeLessThanOrEqual(1440);

  await strip(page).evaluate((el) => (el.scrollLeft = 0));
  await expect(cue(page, 'right')).toBeVisible();
  await expect(cue(page, 'left')).toHaveCount(0);
});

test('the fade never catches the pointer, so a card can still be dragged and clicked', async ({
  page,
}) => {
  await page.goto('/#/projects/food/boards/eng');
  await expect(cue(page, 'right')).toBeVisible();
  await expect(cue(page, 'right')).toHaveCSS('pointer-events', 'none');
  expect(await cue(page, 'right').getAttribute('aria-hidden')).toBe('true');
});

test('a board that fits the screen has no fade', async ({ page }) => {
  await page.goto('/#/projects/food/boards/design');
  await expect(strip(page)).toBeVisible();
  await expect(cue(page, 'right')).toHaveCount(0);
  await expect(cue(page, 'left')).toHaveCount(0);
});
