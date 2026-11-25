import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { bootstrapAdmin, seedBoards, startSessionCleanup } from './bootstrap.js';
import {
  assertDemoDatabase,
  ensureDemoWorkspace,
  limitDemoDatabaseSize,
  startDemoReset,
} from './demo.js';
import { configWarnings, loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/index.js';
import { EventBus } from './events.js';
import { listenFailureLines } from './listen-error.js';
import { ProjectsConfigError, ProjectsRegistry, readProjectsConfig } from './projects-config.js';

/** Starts the server. Exits with status 1 and a named reason on a bad projects.json. */
async function main(): Promise<void> {
  const config = loadConfig();

  // Refuse to start on bad data (PRD 15): a half-valid config is worse than none.
  let projects: ProjectsRegistry;
  try {
    projects = new ProjectsRegistry(readProjectsConfig(config.projectsFile));
  } catch (e) {
    if (e instanceof ProjectsConfigError) {
      console.error('[OfficePM] STARTUP FAILED: ' + e.message);
      process.exit(1);
    }
    throw e;
  }
  console.log(
    '[OfficePM] projects.json OK: ' +
      projects.config.projects.length +
      ' project(s), ' +
      projects.allBoards().length +
      ' board(s), prefixes unique.',
  );

  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir + '/projects', { recursive: true });
  fs.mkdirSync(config.uploadsDir + '/tickets', { recursive: true });
  const db = openDatabase({ dataDir: config.dataDir });
  // Before anything writes (seedBoards below does): a demo must never touch a real database.
  if (config.demoMode) {
    assertDemoDatabase(db);
    limitDemoDatabaseSize(db);
  }

  for (const line of configWarnings(config)) console.warn(line);

  const ctx: AppContext = {
    config,
    db,
    projects,
    events: new EventBus(),
    dashboardCache: new Map(),
  };
  seedBoards(ctx);
  // The public demo comes up with the demo workspace and never creates the random-password admin.
  let createdAdmin = false;
  if (config.demoMode) {
    ensureDemoWorkspace(ctx);
    startDemoReset(ctx);
    console.log('[OfficePM] DEMO_MODE on: public demo, reset every night at 03:00 UTC.');
    console.log(
      `[OfficePM] demo: PM_TRUST_PROXY=${config.trustProxy ? 'on' : 'off'}. The first write requests log ` +
        'how many X-Forwarded-For entries arrived, to check the per-client limits see real visitors.',
    );
  } else {
    createdAdmin = await bootstrapAdmin(ctx);
  }
  startSessionCleanup(ctx);
  ctx.events.startHeartbeat();

  const app = createApp(ctx);
  const port = Number(config.port);
  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(
      '[OfficePM] listening on http://localhost:' + config.port + ' (env=' + config.nodeEnv + ')',
    );
  });
  server.on('error', (err) => {
    const password = createdAdmin && config.adminPasswordGenerated ? config.adminPassword : null;
    const lines = listenFailureLines(err, port, password);
    if (!lines) throw err;
    for (const line of lines) console.error(line);
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  console.error('[OfficePM] STARTUP FAILED:', err);
  process.exit(1);
});
