import type { Dashboard } from '@officepm/shared';
import type { Config } from './config.js';
import type { OpenDatabase } from './db/index.js';
import type { EventBus } from './events.js';
import type { ProjectsRegistry } from './projects-config.js';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
}

/** Hono environment: what middleware puts on the request context. */
export interface AppEnv {
  Variables: {
    user: SessionUser;
    /** Parsed JSON body, or {} when there is none, as v1's express.json gave. */
    body: JsonBody;
  };
}

export type JsonBody = Record<string, unknown>;

export interface DashboardCacheEntry {
  at: number;
  body: Dashboard;
}

/** Everything a service needs, built once at startup. */
export interface AppContext {
  config: Config;
  db: OpenDatabase;
  projects: ProjectsRegistry;
  events: EventBus;
  /** Per-user dashboard results, cleared by any write. */
  dashboardCache: Map<number, DashboardCacheEntry>;
}
