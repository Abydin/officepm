import { expect, type Locator, type Page } from '@playwright/test';

// Demo login created by legacy/scripts/seed-demo.js, which e2e/serve.mjs runs.
export const DEMO = { email: 'maya.okafor@officepm.demo', password: 'demo-password' };

export async function signIn(page: Page, who: { email: string; password: string } = DEMO) {
  await page.goto('/');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/#\/overview$/);
}

export const column = (page: Page, name: string): Locator => page.getByRole('region', { name });
export const card = (scope: Page | Locator, key: string): Locator =>
  scope.locator(`[data-ticket-key="${key}"]`);

/** A real mouse drag in small steps: dnd-kit needs movement past its activation distance. */
export async function dragCard(page: Page, key: string, toColumn: string) {
  const from = await card(page, key).boundingBox();
  const to = await column(page, toColumn).boundingBox();
  if (!from || !to) throw new Error('card or column is not on screen');
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 30, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 90, { steps: 12 });
  await page.mouse.up();
}

/**
 * Picks a card up with Space, steps through the named columns with the arrow keys
 * and drops it with Space. It waits for each screen-reader announcement, because
 * dnd-kit starts listening for the next key a tick after the last one.
 */
export async function keyboardDrag(page: Page, key: string, through: string[]) {
  await card(page, key).focus();
  await page.keyboard.press('Space');
  // "Picked up" is replaced at once by "is over <column>", so wait for that one.
  await expect(page.getByText(`${key} is over `)).toBeAttached();
  // dnd-kit adds its key listener one timer tick after activation; give it that tick.
  await page.waitForTimeout(100);
  for (const name of through) {
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText(`${key} is over ${name}.`)).toBeAttached();
  }
  await page.keyboard.press('Space');
}

/** Demo users share one password; Sam is not an admin. */
export const SAM = { email: 'sam.adeyemi@officepm.demo', password: DEMO.password };
