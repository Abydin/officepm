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
}

// apps/server/{src,dist}/config.(ts|js): three levels up is the repo root.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Reads the same environment variables v1 does, with the same defaults:
 * PORT, PM_DATA_DIR, PM_PROJECTS_FILE, PM_TOKEN, NODE_ENV, ADMIN_EMAIL and
 * ADMIN_PASSWORD, plus the v2-only PM_WEB_DIR and PM_TRUST_PROXY. PM_DATA_DIR defaults to the repo root, where v1 kept pm.db.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.PM_DATA_DIR ? path.resolve(env.PM_DATA_DIR) : path.resolve(REPO_ROOT);
  const adminPasswordGenerated = !env.ADMIN_PASSWORD;
  return {
    port: env.PORT || 3000,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    projectsFile: env.PM_PROJECTS_FILE
      ? path.resolve(env.PM_PROJECTS_FILE)
      : path.join(REPO_ROOT, 'projects.json'),
    webDir: env.PM_WEB_DIR ? path.resolve(env.PM_WEB_DIR) : path.join(REPO_ROOT, 'legacy'),
    pmToken: env.PM_TOKEN || '',
    nodeEnv: env.NODE_ENV || 'development',
    trustProxy: env.PM_TRUST_PROXY === '1' || env.PM_TRUST_PROXY === 'true',
    adminEmail: env.ADMIN_EMAIL || 'admin@officepm.local',
    adminPassword: env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url'),
    adminPasswordGenerated,
  };
}
