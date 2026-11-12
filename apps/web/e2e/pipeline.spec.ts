import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { removeTickets, signIn } from './helpers';

// The owner's scenario, end to end: a feature starts with Product, goes to Design and back, then to
// Engineering where a Backend and a Frontend ticket live under the same feature, past the gate, to QA
// and on to DevOps, with every move on the history timeline.

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
    if (department) {
      await page.request.patch(`/api/users/${u.id}/department`, { data: { department } });
    }
  }
}

async function newFeature(page: Page, title: string) {
  const res = await page.request.post('/api/tickets', {
    data: {
      project_slug: 'food',
      board_slug: 'eng',
      title,
      type: 'epic',
      level: 'epic',
      status: 'Backlog',
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { key: string; phase: string | null };
}

const moveDialog = (page: Page, key: string) => page.getByRole('dialog', { name: `Move ${key}` });
const history = (page: Page) =>
  page.getByRole('dialog').first().getByRole('list', { name: 'Pipeline history' });

async function openFeature(page: Page, key: string) {
  await page.goto(`/#/projects/food/boards/eng/epics?t=${key}`);
  const drawer = page.getByRole('dialog', { name: `Ticket ${key}` });
  await expect(drawer.getByRole('button', { name: 'Move feature' })).toBeVisible();
  return drawer;
}

test.describe('the feature pipeline scenario', () => {
  const made: string[] = [];
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    for (const key of made) await page.request.delete(`/api/tickets/${key}`);
    await removeTickets(page, []);
    await page.close();
  });

  test('Product to Design and back, Engineering with two tickets, the gate, QA, DevOps', async ({
    page,
  }) => {
    await signIn(page);
    await setDepartments(page);

    // An admin sets the project's phases: the last one is DevOps, and each phase names its department.
    await page.goto('/#/admin');
    const settings = page.getByRole('region', { name: 'Feature pipelines' });
    await expect(settings.getByLabel('Phase 5 name')).toHaveValue('Release');
    await settings.getByLabel('Phase 5 name').fill('DevOps');
    await settings.getByLabel('Phase 1 department').fill('Product');
    await settings.getByLabel('Phase 2 department').fill('Design');
    await settings.getByLabel('Phase 3 department').fill('Engineering');
    await settings.getByRole('button', { name: 'Save phases' }).click();
    await expect(settings.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Feature pipelines' }).getByLabel('Phase 5 name'),
    ).toHaveValue('DevOps');

    // A new feature starts at the first phase.
    const feature = await newFeature(page, 'Scenario: loyalty points');
    made.push(feature.key);
    expect(feature.phase).toBe('Product');
    let drawer = await openFeature(page, feature.key);
    await expect(
      drawer.getByRole('list', { name: 'Pipeline' }).locator('[aria-current]'),
    ).toContainText('Product');

    // Product hands it to Design: the dialog suggests Design's people.
    await drawer.getByRole('button', { name: 'Move feature' }).click();
    let dialog = moveDialog(page, feature.key);
    await expect(dialog.getByTestId('current-status')).toHaveText('Product');
    await expect(dialog.getByRole('combobox', { name: 'Move to' })).toHaveValue('Design');
    await expect(dialog.getByRole('combobox', { name: 'Department' })).toHaveValue('Design');
    await dialog
      .getByRole('combobox', { name: 'Hand over to' })
      .selectOption({ label: 'Maya Okafor' });
    await dialog.getByRole('textbox', { name: /Note/ }).fill('The brief is in the project docs.');
    await dialog.getByRole('button', { name: 'Approve and move' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      drawer.getByRole('list', { name: 'Pipeline' }).locator('[aria-current]'),
    ).toContainText('Design');

    // Design rejects it back to Product, with a reason.
    await drawer.getByRole('button', { name: 'Move feature' }).click();
    dialog = moveDialog(page, feature.key);
    await dialog.getByRole('radio', { name: /Reject/ }).check();
    await expect(dialog.getByRole('combobox', { name: 'Move to' })).toHaveValue('Product');
    const sendBack = dialog.getByRole('button', { name: 'Send back' });
    await expect(sendBack).toBeDisabled();
    await dialog.getByRole('textbox', { name: /Reason/ }).fill('The scope is unclear.');
    await sendBack.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      drawer.getByRole('list', { name: 'Pipeline' }).locator('[aria-current]'),
    ).toContainText('Product');

    // Product approves again, and Design approves on to Engineering.
    for (let step = 0; step < 2; step += 1) {
      await drawer.getByRole('button', { name: 'Move feature' }).click();
      dialog = moveDialog(page, feature.key);
      await dialog.getByRole('button', { name: 'Approve and move' }).click();
      await expect(dialog).toHaveCount(0);
    }
    await expect(
      drawer.getByRole('list', { name: 'Pipeline' }).locator('[aria-current]'),
    ).toContainText('Engineering');

    // Engineering: a Backend ticket and a Frontend ticket, each its own ticket under the same feature.
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    const card = page.getByRole('region', { name: new RegExp(feature.key) });
    const add = card.getByRole('form', { name: `Add ticket to ${feature.key}` });
    for (const [title, lane] of [
      ['Scenario: orders API', 'Backend'],
      ['Scenario: order screen', 'Frontend'],
    ] as const) {
      await add.getByLabel('Add ticket to this feature').fill(title);
      await add.getByLabel('Team lane').fill(lane);
      await expect(add.getByLabel('Phase')).toHaveValue('Engineering');
      await add.getByRole('button', { name: 'Add ticket' }).click();
      await expect(
        card.getByRole('region', { name: 'Engineering tickets' }).getByText(title),
      ).toBeVisible();
    }
    const eng = card.getByRole('region', { name: 'Engineering tickets' });
    await expect(eng.getByText('Backend', { exact: true })).toBeVisible();
    await expect(eng.getByText('Frontend', { exact: true })).toBeVisible();
    const tickets = (await (
      await page.request.get('/api/tickets?project=food&board=eng')
    ).json()) as Array<{
      key: string;
      title: string;
      parent_key: string | null;
      phase: string | null;
      department: string | null;
    }>;
    const backend = tickets.find((t) => t.title === 'Scenario: orders API')!;
    const frontend = tickets.find((t) => t.title === 'Scenario: order screen')!;
    expect(backend.key).not.toBe(frontend.key);
    expect([backend.parent_key, frontend.parent_key]).toEqual([feature.key, feature.key]);
    expect([backend.department, frontend.department]).toEqual(['Backend', 'Frontend']);
    made.push(backend.key, frontend.key);

    // The gate: the server refuses without the flag, and the dialog asks for Move anyway.
    const refused = await page.request.post(`/api/tickets/${feature.key}/handoff`, {
      data: { decision: 'approve' },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe(
      '2 tickets in Engineering are still open: confirm to move on anyway',
    );
    drawer = await openFeature(page, feature.key);
    await drawer.getByRole('button', { name: 'Move feature' }).click();
    dialog = moveDialog(page, feature.key);
    await expect(dialog.getByRole('group', { name: 'Open tickets in this phase' })).toContainText(
      '2 of 2 tickets are still open in Engineering.',
    );
    const approve = dialog.getByRole('button', { name: 'Approve and move' });
    await expect(approve).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Move anyway' }).check();
    await approve.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      drawer.getByRole('list', { name: 'Pipeline' }).locator('[aria-current]'),
    ).toContainText('QA');

    // QA is happy and pushes it to DevOps, handing it to a person.
    await drawer.getByRole('button', { name: 'Move feature' }).click();
    dialog = moveDialog(page, feature.key);
    await dialog.getByRole('combobox', { name: 'Move to' }).selectOption('DevOps');
    await dialog
      .getByRole('combobox', { name: 'Hand over to' })
      .selectOption({ label: 'Tunde Bakare' });
    await dialog.getByRole('textbox', { name: /Note/ }).fill('QA passed. Ready to ship.');
    await dialog.getByRole('button', { name: 'Approve and move' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      drawer.getByRole('list', { name: 'Pipeline' }).locator('[aria-current]'),
    ).toContainText('DevOps');

    // The history shows it all, oldest first.
    const moves = history(page).getByRole('listitem');
    await expect(moves).toHaveCount(6);
    await expect(moves.nth(0)).toContainText('Moved from Product to Design');
    await expect(moves.nth(0)).toContainText('The brief is in the project docs.');
    await expect(moves.nth(1)).toContainText('Sent back from Design to Product');
    await expect(moves.nth(1)).toContainText('Reason: The scope is unclear.');
    await expect(moves.nth(2)).toContainText('Moved from Product to Design');
    await expect(moves.nth(3)).toContainText('Moved from Design to Engineering');
    await expect(moves.nth(4)).toContainText('Moved from Engineering to QA');
    await expect(moves.nth(5)).toContainText('Moved from QA to DevOps');
    await expect(moves.nth(5)).toContainText('to Tunde Bakare');
    await expect(moves.nth(5)).toContainText('QA passed. Ready to ship.');

    // A ticket under the feature shows its own phase and lane, and keeps its own state.
    await page.goto(`/#/t/${backend.key}`);
    const ticketDrawer = page.getByRole('dialog', { name: `Ticket ${backend.key}` });
    await expect(ticketDrawer.getByLabel('Phase')).toHaveValue('Engineering');
    await expect(ticketDrawer.getByLabel('Team lane')).toHaveValue('Backend');
  });

  test('a project that never starts a pipeline shows no pipeline noise', async ({ page }) => {
    await signIn(page);
    await page.goto('/#/projects/food/boards/eng/epics');
    const plain = page.getByRole('region', { name: /Payments and receipts/ });
    await expect(plain).toBeVisible();
    await expect(plain.getByRole('list', { name: 'Pipeline' })).toHaveCount(0);
    await expect(plain.getByText('Add ticket to this feature')).toHaveCount(0);
  });
});

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
  test.describe(`pipeline screens, ${theme} theme`, () => {
    let key = '';
    let childKey = '';
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((t) => localStorage.setItem('pm_theme', t), theme);
      await signIn(page);
      await setDepartments(page);
      if (!key) {
        const feature = await newFeature(page, `A11y feature ${theme}`);
        key = feature.key;
        const child = await page.request.post('/api/tickets', {
          data: {
            project_slug: 'food',
            board_slug: 'eng',
            title: `A11y backend ${theme}`,
            type: 'task',
            parent_key: key,
            phase: 'Product',
            department: 'Backend',
          },
        });
        childKey = ((await child.json()) as { key: string }).key;
      }
    });
    test.afterAll(async ({ browser }) => {
      const page = await browser.newPage();
      await signIn(page);
      for (const k of [key, childKey]) if (k) await page.request.delete(`/api/tickets/${k}`);
      await page.close();
    });

    test('epics screen with a feature', async ({ page }) => {
      await page.goto('/#/projects/food/boards/eng/epics');
      await expect(
        page.getByRole('region', { name: new RegExp(key) }).getByRole('list', { name: 'Pipeline' }),
      ).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('epic drawer pipeline, and the phase dialog', async ({ page }) => {
      const drawer = await openFeature(page, key);
      expect(await violations(page)).toEqual([]);
      await drawer.getByRole('button', { name: 'Move feature' }).click();
      await expect(moveDialog(page, key)).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('ticket under a feature, with its tags', async ({ page }) => {
      await page.goto(`/#/t/${childKey}`);
      await expect(page.getByRole('dialog').getByLabel('Team lane')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('admin pipeline settings', async ({ page }) => {
      await page.goto('/#/admin');
      await expect(
        page.getByRole('region', { name: 'Feature pipelines' }).getByLabel('Phase 1 name'),
      ).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}

test.describe('at 390px wide', () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test('the epics screen, the dialog and the admin settings do not scroll sideways', async ({
    page,
  }) => {
    await signIn(page);
    await setDepartments(page);
    const feature = await newFeature(page, 'Narrow feature');
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
    try {
      await page.goto('/#/projects/food/boards/eng/epics');
      await expect(page.getByRole('region', { name: new RegExp(feature.key) })).toBeVisible();
      expect(await overflow()).toBe(false);

      const drawer = await openFeature(page, feature.key);
      await drawer.getByRole('button', { name: 'Move feature' }).click();
      const dialog = moveDialog(page, feature.key);
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      await page.keyboard.press('Escape');

      await page.goto('/#/admin');
      await expect(
        page.getByRole('region', { name: 'Feature pipelines' }).getByLabel('Phase 1 name'),
      ).toBeVisible();
      expect(await overflow()).toBe(false);
    } finally {
      await page.request.delete(`/api/tickets/${feature.key}`);
    }
  });
});
