import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { bootstrapAdmin, seedBoards, startSessionCleanup } from './bootstrap.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/index.js';
import { EventBus } from './events.js';
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

  const ctx: AppContext = {
    config,
    db,
    projects,
    events: new EventBus(),
    dashboardCache: new Map(),
  };
  seedBoards(ctx);
  await bootstrapAdmin(ctx);
  startSessionCleanup(ctx);
  ctx.events.startHeartbeat();

  const app = createApp(ctx);
  serve({ fetch: app.fetch, port: Number(config.port) }, () => {
    console.log(
      '[OfficePM] listening on http://localhost:' + config.port + ' (env=' + config.nodeEnv + ')',
    );
  });
}

main().catch((err: unknown) => {
  console.error('[OfficePM] STARTUP FAILED:', err);
  process.exit(1);
});
