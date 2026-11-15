import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs the real entry point, so it needs the build. tsc -b is incremental and cheap when current.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(REPO_ROOT, 'apps', 'server', 'dist', 'main.js');

const cleanups: Array<() => void> = [];
afterAll(() => {
  while (cleanups.length) cleanups.pop()!();
});

beforeAll(() => {
  execFileSync(
    path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc'),
    ['-b', 'packages/shared', 'apps/server'],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  );
}, 120_000);

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function start(dataDir: string, port: number) {
  // No ADMIN_PASSWORD, so a first run generates one.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    PM_DATA_DIR: dataDir,
    NODE_ENV: 'test',
  };
  delete env.ADMIN_PASSWORD;
  delete env.ADMIN_EMAIL;
  const child = spawn(process.execPath, [MAIN], { cwd: REPO_ROOT, env });
  cleanups.push(() => child.kill('SIGKILL'));
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return {
    output: () => out,
    exited: new Promise<number | null>((resolve) => child.once('exit', resolve)),
    async listening() {
      for (let i = 0; i < 200 && !out.includes('listening on'); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(out).toContain('listening on');
    },
  };
}

describe('first run when the port is taken', () => {
  it('still hands the user the generated admin password, and it logs in on the retry', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-firstrun-'));
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, r));
    cleanups.push(() => blocker.close());
    const taken = (blocker.address() as net.AddressInfo).port;

    const failed = start(dataDir, taken);
    expect(await failed.exited).toBe(1);
    expect(failed.output()).toContain('port ' + taken + ' is already in use');
    const password = /generated password is: (\S+)/.exec(failed.output())?.[1];
    expect(password).toBeTruthy();

    // The retry sees the admin already there and prints nothing, so the password
    // from the failed start is the only copy the user has.
    const port = await freePort();
    const retry = start(dataDir, port);
    await retry.listening();
    expect(retry.output()).not.toContain('Generated admin password');
    const res = await fetch('http://127.0.0.1:' + port + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@officepm.local', password }),
    });
    expect(res.status).toBe(200);
  }, 60_000);
});
