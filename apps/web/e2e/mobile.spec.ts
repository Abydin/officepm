import { expect, test, type Page } from '@playwright/test';
import { DEMO, signIn } from './helpers';

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

// Statuses with a space or a long single word are the ones that used to break mid-word on a phone.
const WORDY = [
  { board: 'support', project: 'food', status: 'Waiting on Customer', type: 'ticket' },
  { board: 'eng', project: 'acme', status: 'Implementation', type: 'task' },
  { board: 'eng', project: 'food', status: 'In Progress', type: 'task' },
  { board: 'eng', project: 'food', status: 'Code Review', type: 'task' },
];

test('My Tickets wraps a status only at spaces and still fits with a wide font', async ({
  page,
}) => {
  const made: string[] = [];
  try {
    for (const w of WORDY) {
      const res = await page.request.post('/api/tickets', {
        data: {
          project_slug: w.project,
          board_slug: w.board,
          title: `Wide font check ${w.status}`,
          type: w.type,
          status: w.status,
          assignee: DEMO.email,
        },
      });
      expect(res.status(), w.status).toBe(201);
      made.push(((await res.json()) as { key: string }).key);
    }
    // Verdana-style metrics: the widest common sans-serif, which the Linux runner's fallback
    // (DejaVu Sans) closely matches.
    await page.goto('/#/mine');
    const table = page.getByRole('table', { name: 'Assigned to you' });
    await expect(table.getByText('Wide font check Implementation')).toBeVisible();
    await page.addStyleTag({
      content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }',
    });

    // A string, because the e2e project's TypeScript has no DOM types to check a page function against.
    const measured = (await page.evaluate(`(() => {
      const el = document.querySelector('table[aria-label="Assigned to you"]');
      const wrap = el.parentElement;
      const rows = [...el.querySelectorAll('tbody tr')].filter((r) =>
        (r.textContent || '').includes('Wide font check'),
      );
      // A word is split mid-word when its glyphs sit on more than one line.
      const split = [];
      const labels = [];
      for (const row of rows) {
        const cell = row.children[3];
        labels.push((cell.textContent || '').trim());
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          for (const m of (n.textContent || '').matchAll(/\\S+/g)) {
            const range = document.createRange();
            range.setStart(n, m.index);
            range.setEnd(n, m.index + m[0].length);
            const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
            if (tops.size > 1) split.push(m[0]);
          }
        }
      }
      // Narrowest the table can get, measured by letting it shrink to its content.
      const before = el.style.width;
      el.style.width = 'min-content';
      const narrowest = el.getBoundingClientRect().width;
      el.style.width = before;
      return {
        labels,
        split,
        spare: wrap.clientWidth - narrowest,
        scrolls: wrap.scrollWidth > wrap.clientWidth,
      };
    })()`)) as { labels: string[]; split: string[]; spare: number; scrolls: boolean };
    expect(measured.labels.sort()).toEqual(
      ['Code Review', 'Implementation', 'In Progress', 'Waiting on Customer'].sort(),
    );
    expect(measured.split, 'words broken mid-word').toEqual([]);
    expect(measured.scrolls).toBe(false);
    expect(measured.spare, 'spare width at the narrowest layout').toBeGreaterThanOrEqual(40);
  } finally {
    for (const key of made) await page.request.delete(`/api/tickets/${key}`);
  }
});
