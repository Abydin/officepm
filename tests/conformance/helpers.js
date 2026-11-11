'use strict';

// Boots a real server in a child process against a throwaway data directory, so
// every test file gets its own database and uploads/ and nothing touches the
// developer's pm.db. Talks to it over HTTP, the same way a browser does, because
// the things most worth testing here (session cookies, multipart uploads,
// Content-Disposition) only exist at that boundary.

const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
// The suite peeks into the server's database file, so it borrows the server's copy of
// better-sqlite3 rather than adding a root dependency.
const Database = require(require.resolve('better-sqlite3', { paths: [path.join(REPO_ROOT, 'apps', 'server')] }));

// Which server the suite exercises. OFFICEPM_SERVER_CMD is a command line split
// on spaces; a lone .js path is run with this node. Unset, it is the compiled v2
// server, so `pnpm run build:server` has to have run first (`pnpm test:conformance`
// does that). Commands run from the repo root so relative paths work.
function commandFromEnv(name, fallbackScript) {
  const raw = (process.env[name] || '').trim();
  if (!raw) {
    const script = path.join(REPO_ROOT, fallbackScript);
    if (!fs.existsSync(script)) {
      throw new Error(script + ' does not exist. Run `pnpm run build:server` first.');
    }
    return { cmd: process.execPath, args: [script] };
  }
  const parts = raw.split(/\s+/);
  if (parts.length === 1 && parts[0].endsWith('.js')) {
    return { cmd: process.execPath, args: [path.resolve(REPO_ROOT, parts[0])] };
  }
  return { cmd: parts[0], args: parts.slice(1) };
}
const SERVER_CMD = commandFromEnv('OFFICEPM_SERVER_CMD', path.join('apps', 'server', 'dist', 'main.js'));
// Seed script spawned by seed.test.js. Override with OFFICEPM_SEED_CMD.
const SEED_CMD = commandFromEnv('OFFICEPM_SEED_CMD', path.join('apps', 'server', 'dist', 'seed-main.js'));

const ADMIN = { email: 'admin@officepm.local', password: 'test-admin-password' };
const PM_TOKEN = 'test-pm-token';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Boot and wait until it answers, or fail loudly with whatever it printed. A
// silent timeout here would send someone hunting in the wrong place.
async function startServer(opts = {}) {
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-test-'));
  const port = await freePort();
  const env = Object.assign({}, process.env, {
    PORT: String(port),
    PM_DATA_DIR: dataDir,
    PM_TOKEN,
    NODE_ENV: 'test',
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password
  }, opts.env || {});
  if (opts.projectsFile) env.PM_PROJECTS_FILE = opts.projectsFile;

  const child = spawn(SERVER_CMD.cmd, SERVER_CMD.args, { env, cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  const base = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 10000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error('server exited with code ' + child.exitCode + ':\n' + output);
    }
    try {
      await fetch(base + '/api/me');
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        throw new Error('server did not come up in 10s:\n' + output);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  return {
    base,
    dataDir,
    output: () => output,
    db: () => new Database(path.join(dataDir, 'pm.db')),
    async stop() {
      child.kill('SIGKILL');
      await new Promise((r) => child.once('exit', r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

// Boots with a projects.json written for this test, for the startup-validation
// cases. Returns what the process printed and the code it died with.
async function bootWithConfig(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-cfg-'));
  const file = path.join(dir, 'projects.json');
  fs.writeFileSync(file, typeof config === 'string' ? config : JSON.stringify(config));
  const port = await freePort();
  const child = spawn(SERVER_CMD.cmd, SERVER_CMD.args, {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      PM_DATA_DIR: dir,
      PM_PROJECTS_FILE: file,
      PM_TOKEN,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const code = await new Promise((resolve) => {
    // A config we expect to be VALID never exits, so this timeout is the pass
    // condition for that case, not a failure. Kept short to keep the suite quick.
    const t = setTimeout(() => { child.kill('SIGKILL'); resolve('did-not-exit'); }, 2000);
    child.once('exit', (c) => { clearTimeout(t); resolve(c); });
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, output };
}

// A tiny cookie-aware client. The session cookie is the thing under test in
// several places, so it is carried explicitly rather than hidden in a library.
function client(base) {
  let cookie = '';
  async function req(method, url, body, extraHeaders) {
    const headers = Object.assign({}, extraHeaders || {});
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setCookie) cookie = c.split(';')[0];
    return res;
  }
  return {
    get: (u, h) => req('GET', u, undefined, h),
    post: (u, b, h) => req('POST', u, b, h),
    patch: (u, b, h) => req('PATCH', u, b, h),
    del: (u, b, h) => req('DELETE', u, b, h),
    cookie: () => cookie,
    clearCookie() { cookie = ''; },
    setCookie(c) { cookie = c; }
  };
}

async function loginAsAdmin(base) {
  const c = client(base);
  const res = await c.post('/api/login', { email: ADMIN.email, password: ADMIN.password });
  if (res.status !== 200) throw new Error('admin login failed: ' + res.status + ' ' + (await res.text()));
  return c;
}

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error('not JSON (' + res.status + '): ' + text.slice(0, 300)); }
}

module.exports = { REPO_ROOT, SEED_CMD, startServer, bootWithConfig, client, loginAsAdmin, json, ADMIN, PM_TOKEN };
