// Starts the v2 server for the end-to-end run: a fresh demo database (the v2 seeder, apps/server/src/seed) in a temp
// directory (never the repo's pm.db or .data), serving the built web client.
// Run `pnpm run test:e2e` from the repo root, which builds both first.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-e2e-'));
process.on('exit', () => fs.rmSync(dataDir, { recursive: true, force: true }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

execFileSync(process.execPath, [path.join(repo, 'apps/server/dist/seed-main.js')], {
  env: { ...process.env, PM_DATA_DIR: dataDir },
  stdio: 'inherit',
});

Object.assign(process.env, {
  PM_DATA_DIR: dataDir,
  PM_WEB_DIR: path.join(repo, 'apps/web/dist'),
  PORT: process.env.E2E_PORT ?? '3100',
  ADMIN_PASSWORD: 'e2e-admin-password',
});
await import(pathToFileURL(path.join(repo, 'apps/server/dist/main.js')).href);
