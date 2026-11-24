import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCsp, injectGoatCounter } from './http/security-headers.js';
import {
  createApp,
  EventBus,
  loadConfig,
  openDatabase,
  ProjectsRegistry,
  parseProjectsConfig,
} from './index.js';

const INDEX = `<!doctype html>
<html>
  <head>
    <title>OfficePM</title>
    <script>document.documentElement.dataset.x = '1';</script>
  </head>
  <body><div id="root"></div><script type="module" src="/assets/app.js"></script></body>
</html>
`;
const TAG =
  '<script data-goatcounter="https://demo-site.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function appWith(env: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-gc-'));
  dirs.push(dir);
  const webDir = path.join(dir, 'web');
  fs.mkdirSync(webDir);
  fs.writeFileSync(path.join(webDir, 'index.html'), INDEX);
  return createApp({
    config: loadConfig({ PM_DATA_DIR: dir, PM_WEB_DIR: webDir, ADMIN_PASSWORD: 'unused', ...env }),
    db: openDatabase({ filename: ':memory:' }),
    projects: new ProjectsRegistry(parseProjectsConfig('{"projects":[]}')),
    events: new EventBus(),
    dashboardCache: new Map(),
  });
}

const directive = (csp: string, name: string) =>
  csp
    .split('; ')
    .find((d) => d.startsWith(name + ' '))
    ?.split(' ')
    .slice(1) ?? [];

describe('visitor counting, off', () => {
  it('serves the page byte for byte, with no external host in the HTML or any header', async () => {
    const app = appWith({});
    for (const url of ['/', '/api/health', '/api/config']) {
      const res = await app.request(url);
      const headers = [...res.headers.entries()].flat().join('\n');
      expect(headers, url).not.toMatch(/goatcounter|zgo\.at/i);
    }
    const page = await app.request('/');
    expect(await page.text()).toBe(INDEX);
    expect(page.headers.get('content-security-policy')).toBe(buildCsp(INDEX));
  });

  it('ignores an empty GOATCOUNTER_CODE', async () => {
    const res = await appWith({ GOATCOUNTER_CODE: '  ' }).request('/');
    expect(await res.text()).toBe(INDEX);
  });
});

describe('visitor counting, on', () => {
  it('adds the one script tag and widens only script-src, img-src and connect-src', async () => {
    const res = await appWith({ GOATCOUNTER_CODE: 'demo-site' }).request('/');
    const html = await res.text();
    expect(html).toContain(TAG);
    expect(html.replace(TAG + '\n  ', '')).toBe(INDEX);
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);

    const csp = res.headers.get('content-security-policy') ?? '';
    expect(directive(csp, 'script-src')).toContain('gc.zgo.at');
    expect(directive(csp, 'img-src')).toContain('demo-site.goatcounter.com');
    expect(directive(csp, 'connect-src')).toContain('demo-site.goatcounter.com');
    // Every other directive is exactly what it is with counting off.
    const plain = buildCsp(INDEX).split('; ');
    const widened = new Set(['script-src', 'img-src', 'connect-src']);
    for (const d of plain.filter((p) => !widened.has(p.split(' ')[0] as string))) {
      expect(csp.split('; ')).toContain(d);
    }
    expect(csp).toMatch(/script-src 'self' 'sha256-[\w+/=]+' gc\.zgo\.at(;|$)/);
    expect(csp).toContain("default-src 'self'");
  });

  it('also carries the widened policy on API responses', async () => {
    const res = await appWith({ GOATCOUNTER_CODE: 'demo-site' }).request('/api/health');
    expect(res.headers.get('content-security-policy')).toContain('demo-site.goatcounter.com');
  });

  it('refuses a code that could carry markup, a dot, or a bad edge, at startup', () => {
    for (const bad of ['a"><script>alert(1)</script>', 'a.b', '-lead', 'trail-', 'sp ace', 'a/b']) {
      expect(() => loadConfig({ GOATCOUNTER_CODE: bad }), bad).toThrow(/GOATCOUNTER_CODE/);
      expect(() => injectGoatCounter(INDEX, bad), bad).toThrow(/GOATCOUNTER_CODE/);
      expect(() => buildCsp(INDEX, bad), bad).toThrow(/GOATCOUNTER_CODE/);
    }
    expect(loadConfig({ GOATCOUNTER_CODE: 'Abc-123' }).goatCounterCode).toBe('Abc-123');
  });

  it('adds the tag once, before </head>', () => {
    const out = injectGoatCounter(INDEX, 'demo-site');
    expect(out.split('goatcounter.com/count')).toHaveLength(2);
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf('</head>'));
  });
});
