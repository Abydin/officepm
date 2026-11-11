import { describe, expect, it } from 'vitest';
import { createApp, EventBus, loadConfig, openDatabase, ProjectsRegistry } from './index.js';
import { parseProjectsConfig } from './projects-config.js';

describe('GET /api/health', () => {
  it('answers 200 without a session, and says so even with no admin yet', async () => {
    const db = openDatabase({ filename: ':memory:' });
    const app = createApp({
      config: loadConfig({ PM_DATA_DIR: '/nonexistent', ADMIN_PASSWORD: 'unused' }),
      db,
      projects: new ProjectsRegistry(parseProjectsConfig('{"projects":[]}')),
      events: new EventBus(),
      dashboardCache: new Map(),
    });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    db.close();
  });

  it('is not healthy when the database is gone', async () => {
    const db = openDatabase({ filename: ':memory:' });
    const app = createApp({
      config: loadConfig({ PM_DATA_DIR: '/nonexistent', ADMIN_PASSWORD: 'unused' }),
      db,
      projects: new ProjectsRegistry(parseProjectsConfig('{"projects":[]}')),
      events: new EventBus(),
      dashboardCache: new Map(),
    });
    db.close();
    const res = await app.request('/api/health');
    expect(res.status).toBe(500);
  });
});
