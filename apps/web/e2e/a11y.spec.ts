import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// Reports every violation with its rule, impact and the elements it hit, so a
// failure says what to fix. The page is checked in both themes.
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

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      // Panels fade and slide in; axe measures contrast mid-fade otherwise.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((t) => localStorage.setItem('pm_theme', t), theme);
      await signIn(page);
    });

    test('board', async ({ page }) => {
      await page.goto('/#/projects/food/boards/eng');
      await expect(page.locator('[data-ticket-key]').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('ticket drawer', async ({ page }) => {
      await page.goto('/#/t/FOOD-ENG-8');
      await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'GitHub' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('command palette', async ({ page }) => {
      await page.goto('/#/projects/food/boards/eng');
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('assignee picker open inside the drawer', async ({ page }) => {
      await page.goto('/#/t/FOOD-ENG-8');
      const drawer = page.getByRole('dialog');
      await drawer.getByRole('button', { name: /^Assignee/ }).click();
      await expect(page.getByRole('combobox', { name: /Find a person/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('keyboard shortcuts help', async ({ page }) => {
      await page.goto('/#/projects/food/boards/eng');
      await expect(page.locator('[data-ticket-key]').first()).toBeVisible();
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('my tickets', async ({ page }) => {
      await page.goto('/#/mine');
      await expect(page.getByRole('table')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}
