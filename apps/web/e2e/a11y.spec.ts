import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SAM, signIn } from './helpers';

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

    test('projects list with the full sidebar', async ({ page }) => {
      await page.goto('/#/projects');
      await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
      await expect(
        page
          .getByRole('navigation', { name: 'Projects and boards' })
          .getByRole('link', { name: 'Acme', exact: true }),
      ).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('handoff dialog, approving and rejecting', async ({ page }) => {
      const res = await page.request.post('/api/tickets', {
        data: {
          project_slug: 'food',
          board_slug: 'design',
          title: `A11y handoff ${theme}`,
          type: 'task',
          status: 'In Progress',
        },
      });
      const { key } = (await res.json()) as { key: string };
      await page.goto(`/#/projects/food/boards/design?t=${key}`);
      await page.getByRole('dialog').getByLabel('Status').selectOption('Review');
      const dialog = page.getByRole('dialog', { name: `Move ${key}` });
      await expect(dialog.getByRole('combobox', { name: 'Hand over to' })).toBeVisible();
      await dialog.getByLabel('Add attachments').setInputFiles({
        name: 'shot.png',
        mimeType: 'image/png',
        buffer: Buffer.from('x'),
      });
      await expect(dialog.getByRole('list', { name: 'Attachments to send' })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await dialog.getByRole('radio', { name: /Reject/ }).check();
      await expect(dialog.getByRole('textbox', { name: /Reason/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('keyboard shortcuts help', async ({ page }) => {
      await page.goto('/#/projects/food/boards/eng');
      await expect(page.locator('[data-ticket-key]').first()).toBeVisible();
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('backlog, then with the Definition of Ready gate open', async ({ page }) => {
      await page.goto('/#/projects/food/boards/eng/backlog');
      await expect(page.getByRole('region', { name: 'Sprint 14' })).toBeVisible();
      await expect(page.getByRole('row', { name: /Order history filters/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      // A planned sprint to open the gate on. The seed has none, so make one.
      const name = `A11y ${theme}`;
      await page.request.post('/api/projects/food/boards/eng/sprints', { data: { name } });
      await page.reload();
      const planned = page.getByRole('region', { name });
      await planned.getByRole('button', { name: 'Activate' }).click();
      await expect(planned.getByRole('group', { name: 'Definition of Ready' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('cycles on a Shape Up board', async ({ page }) => {
      await page.goto('/#/projects/northwind/boards/product/backlog');
      await expect(page.getByRole('heading', { name: 'Cycles' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('phases on a Waterfall board', async ({ page }) => {
      await page.goto('/#/projects/acme/boards/eng/backlog');
      await expect(page.getByRole('heading', { name: 'Phase order' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('scrumban backlog with velocity', async ({ page }) => {
      await page.goto('/#/projects/food/boards/support/backlog');
      await expect(page.getByRole('region', { name: 'Velocity' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('epics', async ({ page }) => {
      await page.goto('/#/projects/food/boards/eng/epics');
      await expect(page.getByRole('region', { name: /Group ordering/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('retros list and one retro', async ({ page }) => {
      await page.goto('/#/projects/food/boards/eng/retros');
      await expect(page.getByRole('link', { name: 'Retro: Sprint 13' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('link', { name: 'Retro: Sprint 13' }).click();
      await expect(page.getByRole('region', { name: 'Went well' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('standup', async ({ page }) => {
      await page.goto('/#/projects/food/boards/eng/standup');
      await expect(page.getByRole('region', { name: 'Maya Okafor' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('project page and docs and files', async ({ page }) => {
      await page.goto('/#/projects/food');
      await expect(page.getByRole('region', { name: 'Docs & Links' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.goto('/#/projects/food/docs');
      await expect(page.getByRole('region', { name: 'Links' })).toBeVisible();
      await expect(page.getByRole('link', { name: /Ordering API reference/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('admin, and its reset password dialog', async ({ page }) => {
      await page.goto('/#/admin');
      await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Boards' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Reset password for Sam Adeyemi' }).click();
      await expect(page.getByRole('dialog', { name: /Reset password/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('my tickets', async ({ page }) => {
      await page.goto('/#/mine');
      await expect(page.getByRole('table')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('my tickets with something handed to me', async ({ page, browser }) => {
      // Sam hands a ticket to Maya, so Maya's page shows the inbox and the counts.
      const context = await browser.newContext();
      const sam = await context.newPage();
      await signIn(sam, SAM);
      const created = await sam.request.post('/api/tickets', {
        data: {
          project_slug: 'food',
          board_slug: 'design',
          title: `A11y inbox ${theme}`,
          type: 'task',
          status: 'In Progress',
        },
      });
      const { key } = (await created.json()) as { key: string };
      const handoff = await sam.request.post(`/api/tickets/${key}/handoff`, {
        data: {
          decision: 'approve',
          assignee: 'maya.okafor@officepm.demo',
          note: 'Please review the spacing',
        },
      });
      expect(handoff.status()).toBe(200);
      await context.close();

      await page.goto('/#/mine');
      await expect(page.getByRole('region', { name: 'Handed to you' })).toContainText(key);
      expect(await violations(page)).toEqual([]);
    });
  });
}
