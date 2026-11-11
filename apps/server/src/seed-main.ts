import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { ProjectsConfigError, ProjectsRegistry, readProjectsConfig } from './projects-config.js';
import { seedDemo, SeedRefusal } from './seed/demo.js';

const USAGE = `Usage: PM_DATA_DIR=<dir> pnpm run seed [--allow-non-empty]

Fills <dir>/pm.db with the demo workspace (6 users, 30 tickets across the 7 boards, 4 sprints, 1 retro).
Writes only to PM_DATA_DIR, which must be set. Refuses a database that has tickets, and a
data directory that already has users unless --allow-non-empty is given.
Demo login: maya.okafor@officepm.demo / demo-password. Demo data only: never seed a server you expose.`;

/** `pnpm run seed`: the demo workspace for a throwaway or first-run data directory. */
function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const unknown = args.filter((a) => a !== '--allow-non-empty');
  if (unknown.length > 0) {
    console.error('[seed] unknown argument: ' + unknown.join(' ') + '\n\n' + USAGE);
    process.exit(2);
  }
  if (!process.env.PM_DATA_DIR) {
    // loadConfig would fall back to the repo root, where a v1 pm.db may be.
    console.error('[seed] PM_DATA_DIR is not set. Name the data directory to seed explicitly.\n');
    console.error(USAGE);
    process.exit(2);
  }

  const config = loadConfig();
  let registry: ProjectsRegistry;
  try {
    registry = new ProjectsRegistry(readProjectsConfig(config.projectsFile));
  } catch (e) {
    if (e instanceof ProjectsConfigError) {
      console.error('[seed] ' + e.message);
      process.exit(1);
    }
    throw e;
  }

  const db = openDatabase({ dataDir: config.dataDir });
  try {
    const summary = seedDemo(db, registry, {
      allowExistingUsers: process.argv.includes('--allow-non-empty'),
    });
    console.log(
      `[seed] Created ${summary.tickets} tickets, ${summary.users} users, ${summary.sprints} sprints and ${summary.retros} retro in ` +
        path.join(config.dataDir, 'pm.db'),
    );
    console.log(`[seed] Demo login: ${summary.login.email} / ${summary.login.password}`);
  } catch (e) {
    if (e instanceof SeedRefusal) {
      console.error('[seed] ' + e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  } finally {
    db.close();
  }
}

main();
