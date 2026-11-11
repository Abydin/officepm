import bcrypt from 'bcrypt';
import { sql } from 'drizzle-orm';
import type { AppContext } from './context.js';
import { schema } from './db/index.js';
import { BCRYPT_ROUNDS } from './modules/auth/service.js';

const SESSION_SWEEP_MS = 60 * 60 * 1000;

/**
 * Idempotent startup work (PRD 13): one board_settings row and one counter per
 * configured board, so projects.json stays the owner of flow and the agile
 * flag while runtime edits (WIP limits, DoD, DoR) are only defaulted, never
 * clobbered.
 */
export function seedBoards(ctx: AppContext): void {
  const { orm } = ctx.db;
  const { boardSettings, counters } = schema;
  orm.transaction((tx) => {
    for (const { project, board } of ctx.projects.allBoards()) {
      tx.insert(boardSettings)
        .values({
          project_slug: project.slug,
          board_slug: board.slug,
          flow: board.flow,
          agile_enabled: board.agile ? 1 : 0,
          wip_limits: JSON.stringify(board.wip_limits || {}),
          definition_of_done: JSON.stringify(board.definition_of_done || []),
          definition_of_ready: JSON.stringify(board.definition_of_ready || []),
        })
        .onConflictDoUpdate({
          target: [boardSettings.project_slug, boardSettings.board_slug],
          set: { flow: sql`excluded.flow`, agile_enabled: sql`excluded.agile_enabled` },
        })
        .run();
      tx.insert(counters).values({ prefix: board.prefix, next: 1 }).onConflictDoNothing().run();
    }
  });
}

/** PRD 6.12: no self-signup, so the first admin has to exist before anyone logs in. */
export async function bootstrapAdmin(ctx: AppContext): Promise<void> {
  const { orm } = ctx.db;
  const { users } = schema;
  const count =
    orm
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .get()?.n ?? 0;
  if (count > 0) return;
  const { adminEmail, adminPassword, adminPasswordGenerated } = ctx.config;
  const hash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
  orm.insert(users).values({ email: adminEmail, name: 'Admin', password: hash, is_admin: 1 }).run();
  if (adminPasswordGenerated) {
    console.log('[OfficePM] Bootstrapped first admin user: ' + adminEmail);
    console.log(
      '[OfficePM] Generated admin password (shown once, not stored anywhere in plaintext): ' +
        adminPassword,
    );
    console.log(
      '[OfficePM] Log in and change it, or set ADMIN_EMAIL/ADMIN_PASSWORD env vars before first boot next time.',
    );
  } else {
    console.log(
      '[OfficePM] Bootstrapped first admin user: ' +
        adminEmail +
        ' (password from ADMIN_PASSWORD env var)',
    );
  }
}

/**
 * Deletes expired sessions now and hourly. expires_at is an ISO string and
 * datetime('now') is not, so both sides go through datetime() before comparing
 * (the same fix as the auth middleware). Returns a function that stops the timer.
 */
export function startSessionCleanup(ctx: AppContext): () => void {
  const { orm } = ctx.db;
  const { sessions } = schema;
  const sweep = () => {
    const n = orm
      .delete(sessions)
      .where(sql`datetime(${sessions.expires_at}) < datetime('now')`)
      .run().changes;
    if (n) console.log('[OfficePM] cleaned up ' + n + ' expired session(s)');
  };
  sweep();
  const timer = setInterval(sweep, SESSION_SWEEP_MS);
  timer.unref();
  return () => clearInterval(timer);
}
