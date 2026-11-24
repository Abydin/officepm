import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number | string;
  /** Holds pm.db and uploads/. */
  dataDir: string;
  uploadsDir: string;
  projectsFile: string;
  /** Directory the v1 browser client is served from until the v2 web app replaces it. */
  webDir: string;
  /** Shared secret for the CI webhooks. Empty means the webhooks are disabled. */
  pmToken: string;
  nodeEnv: string;
  /**
   * Trust X-Forwarded-For for the client address (PM_TRUST_PROXY=1). Only safe
   * behind a proxy that sets it, such as the Tailscale or Caddy setup in ROLLOUT.md.
   */
  trustProxy: boolean;
  adminEmail: string;
  adminPassword: string;
  /** True when no ADMIN_PASSWORD was set, so one was generated and must be printed once. */
  adminPasswordGenerated: boolean;
  /** DEMO_MODE=true: the hosted public demo (see demo.ts). Off unless set. */
  demoMode: boolean;
  /** GoatCounter site code (GOATCOUNTER_CODE), already validated. Empty means no visitor counting. */
  goatCounterCode: string;
}

/** A DNS label: what a GoatCounter site code is. Strict, because the value goes into served HTML. */
export const GOATCOUNTER_CODE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * DEMO_MODE: true, 1 or yes (any case) turns the demo on; unset, empty, false, 0, no or off leaves
 * it off. Anything else is a typo, and silently running it as a normal instance is not what
 * the operator meant, so it stops the server instead.
 */
export function parseDemoMode(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  if (v === 'true' || v === '1' || v === 'yes') return true;
  throw new Error(
    'DEMO_MODE is set to an unrecognised value. Use true, 1 or yes to run the demo, or leave it unset.',
  );
}

// apps/server/{src,dist}/config.(ts|js): three levels up is the repo root.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Reads the same environment variables v1 does, with the same defaults:
 * PORT, PM_DATA_DIR, PM_PROJECTS_FILE, PM_TOKEN, NODE_ENV, ADMIN_EMAIL and
 * ADMIN_PASSWORD, plus the v2-only PM_WEB_DIR and PM_TRUST_PROXY. PM_DATA_DIR defaults to the repo root, where v1 kept pm.db.
 * DEMO_MODE and GOATCOUNTER_CODE belong to the hosted demo and are off when unset.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const demoMode = parseDemoMode(env.DEMO_MODE);
  // The demo wipes its database nightly, so it must never fall back to the repo root, where a real pm.db may be.
  if (demoMode && !env.PM_DATA_DIR) {
    throw new Error('DEMO_MODE needs PM_DATA_DIR set to a directory of its own.');
  }
  const goatCounterCode = (env.GOATCOUNTER_CODE ?? '').trim();
  if (goatCounterCode && !GOATCOUNTER_CODE_PATTERN.test(goatCounterCode)) {
    throw new Error('GOATCOUNTER_CODE may only contain letters, digits and hyphens.');
  }
  const dataDir = env.PM_DATA_DIR ? path.resolve(env.PM_DATA_DIR) : path.resolve(REPO_ROOT);
  const adminPasswordGenerated = !env.ADMIN_PASSWORD;
  return {
    port: env.PORT || 3000,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    projectsFile: env.PM_PROJECTS_FILE
      ? path.resolve(env.PM_PROJECTS_FILE)
      : path.join(REPO_ROOT, 'projects.json'),
    webDir: env.PM_WEB_DIR
      ? path.resolve(env.PM_WEB_DIR)
      : path.join(REPO_ROOT, 'apps', 'web', 'dist'),
    pmToken: env.PM_TOKEN || '',
    nodeEnv: env.NODE_ENV || 'development',
    trustProxy: env.PM_TRUST_PROXY === '1' || env.PM_TRUST_PROXY === 'true',
    adminEmail: env.ADMIN_EMAIL || 'admin@officepm.local',
    adminPassword: env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url'),
    adminPasswordGenerated,
    demoMode,
    goatCounterCode,
  };
}
