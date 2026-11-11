import path from 'node:path';
import { backupAll } from './backup.js';
import { loadConfig } from './config.js';

/**
 * `pnpm run backup [outDir]`: backs up the data directory PM_DATA_DIR points at
 * (default: the repo root, where v1 kept pm.db). Safe to run while the server is up.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const outDir = path.resolve(process.argv[2] ?? path.join(config.dataDir, 'backups'));
  const { archive, dbBytes } = await backupAll({
    dataDir: config.dataDir,
    projectsFile: config.projectsFile,
    outDir,
  });
  console.log('[OfficePM] backup written: ' + archive + ' (database ' + dbBytes + ' bytes)');
}

main().catch((err: unknown) => {
  console.error('[OfficePM] BACKUP FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
