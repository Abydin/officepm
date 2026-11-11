import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('opens the seeded retro, adds a card by keyboard, and it survives a reload', async ({
  page,
}) => {
  await page.goto('/#/projects/food/boards/eng');
  await page.getByRole('link', { name: 'Retros' }).click();
  await page.getByRole('link', { name: 'Retro: Sprint 13' }).click();
  await expect(page).toHaveURL(/boards\/eng\/retros\/[0-9a-f-]+$/);
  // The tab stays current on the retro's own page.
  await expect(page.getByRole('link', { name: 'Retros' })).toHaveAttribute('aria-current', 'page');

  for (const name of ['Went well', "Didn't go well", 'Action items']) {
    await expect(page.getByRole('region', { name })).toBeVisible();
  }
  const didnt = page.getByRole('region', { name: "Didn't go well" });
  await didnt.getByLabel("Add a card to Didn't go well").fill('E2E: flaky staging deploys');
  await page.keyboard.press('Enter');
  await expect(didnt.getByText('E2E: flaky staging deploys')).toBeVisible();
  await expect(didnt.getByText('Maya Okafor').last()).toBeVisible();
  await expect(didnt.getByLabel("Add a card to Didn't go well")).toHaveValue('');

  await page.reload();
  await expect(
    page.getByRole('region', { name: "Didn't go well" }).getByText('E2E: flaky staging deploys'),
  ).toBeVisible();
});

test('a card added in another session appears here without a reload', async ({ page, browser }) => {
  await page.goto('/#/projects/food/boards/eng/retros');
  await page.getByRole('link', { name: 'Retro: Sprint 13' }).click();
  const well = page.getByRole('region', { name: 'Went well' });
  await expect(well).toBeVisible();

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage);
  await otherPage.goto(page.url());
  await otherPage
    .getByRole('region', { name: 'Went well' })
    .getByLabel('Add a card to Went well')
    .fill('E2E: live card');
  await otherPage.keyboard.press('Enter');

  await expect(well.getByText('E2E: live card')).toBeVisible();
  await other.close();
});
