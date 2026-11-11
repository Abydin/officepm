import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// The server sends a strict Content-Security-Policy with the built client. These
// check the real browser accepts it: nothing the client needs is blocked, the one
// inline script runs through its hash, and the lazily loaded screens come from /assets.
test.describe('security headers with the built client', () => {
  test('the page loads, signs in and visits lazy screens with no CSP violation', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (/content security policy|refused to/i.test(m.text())) problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(e.message));
    // Set before the page's own inline script runs: it must apply this value.
    await page.addInitScript(() => localStorage.setItem('pm_theme', 'light'));

    const document = page.waitForResponse((r) => r.request().resourceType() === 'document');
    await page.goto('/');
    const headers = (await document).headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toMatch(/script-src 'self' 'sha256-[\w+/=]+'(;|$)/);

    // If the hash did not match, the browser would block the script and keep the default.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await signIn(page);
    const chunk = page.waitForResponse((r) => /\/assets\/admin-page-[\w-]+\.js$/.test(r.url()));
    await page.goto('/#/admin');
    await expect(page.getByRole('heading', { name: 'Admin' }).first()).toBeVisible();
    const res = await chunk;
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toContain('immutable');

    await page.goto('/#/projects/food/boards/eng/backlog');
    await expect(page.getByRole('heading', { name: /backlog/i }).first()).toBeVisible();
    // The live event stream is a connect-src 'self' request: still allowed.
    await page.goto('/#/projects/food/boards/eng');
    await expect(page.locator('[data-ticket-key]').first()).toBeVisible();

    expect(problems).toEqual([]);
  });

  test('the app cannot be framed, not even by itself', async ({ page, baseURL }) => {
    await page.goto('/');
    // A string, because this directory's type-check has no DOM lib.
    await page.evaluate(`(() => {
      const frame = document.createElement('iframe');
      frame.id = 'trap';
      frame.src = ${JSON.stringify(`${baseURL}/`)};
      document.body.append(frame);
    })()`);
    const frame = await (await page.locator('#trap').elementHandle())!.contentFrame();
    // A framed app would settle on its own URL; a refused one on the browser's error page.
    await expect.poll(() => frame!.url(), { timeout: 5000 }).not.toBe('about:blank');
    expect(frame!.url()).toMatch(/^chrome-error:/);
  });
});
