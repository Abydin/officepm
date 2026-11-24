import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// The e2e server is not in demo mode, so the page is told it is: /api/config is answered
// in the browser. The banner is fixed over the top and pads #root, so what matters here is
// that it does not cover the app and does not make the page scroll, in both themes and on a phone.
const BANNER = 'Public demo. Anyone can sign in, data is public and wiped nightly.';

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

const verticalOverflow = (page: Page) =>
  page.evaluate('document.documentElement.scrollHeight - document.documentElement.clientHeight');

for (const theme of ['dark', 'light'] as const) {
  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 800 }],
    ['phone', { width: 375, height: 700 }],
  ] as const) {
    test(`public demo banner, ${theme} theme, ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((t) => localStorage.setItem('pm_theme', t), theme);
      await page.route('**/api/config', (route) => route.fulfill({ json: { demo: true } }));

      await page.goto('/');
      const banner = page.getByRole('note', { name: 'Public demo' });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(BANNER);
      const bar = (await banner.boundingBox())!;
      const form = (await page.getByRole('button', { name: 'Sign in' }).boundingBox())!;
      expect(form.y).toBeGreaterThan(bar.y + bar.height);
      expect(await verticalOverflow(page)).toBeLessThanOrEqual(0);
      expect(await violations(page)).toEqual([]);

      await signIn(page);
      await page.goto('/#/projects/food/boards/eng');
      await expect(page.locator('[data-ticket-key]').first()).toBeVisible();
      const top = (await page.locator('header').first().boundingBox())!;
      expect(top.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
      expect(await verticalOverflow(page)).toBeLessThanOrEqual(0);
      expect(await violations(page)).toEqual([]);
    });
  }
}
