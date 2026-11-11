import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type { OpenDatabase } from '../db/index.js';
import { BCRYPT_ROUNDS } from '../modules/auth/service.js';
import type { ProjectsRegistry } from '../projects-config.js';
import type { BoardConfig, ProjectConfig } from '../projects-config.js';
import { COMMENTS, DEMO_PASSWORD, DOD, emailOf, MAYA, TICKETS, USERS } from './demo-data.js';

export interface SeedSummary {
  tickets: number;
  users: number;
  sprints: number;
  retros: number;
  login: { email: string; password: string };
}

export class SeedRefusal extends Error {}

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC), `daysAgo` days back at the given hour, never in the future. */
function stamp(daysAgo: number, hour = 10, minute = 0): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  d.setUTCHours(hour, minute, 0, 0);
  const capped = d.getTime() > Date.now() ? new Date() : d;
  return capped.toISOString().replace('T', ' ').slice(0, 19);
}

/** A plain YYYY-MM-DD date, `offset` days from today. */
function day(offset: number): string {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

/**
 * Counts what is already in the database, so the caller can decide whether seeding is safe.
 * Tickets are a hard stop (the key counters would collide); other users are a soft one.
 */
export function inspectTarget(db: OpenDatabase): { tickets: number; users: number } {
  const count = (table: string): number =>
    (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { tickets: count('tickets'), users: count('users') };
}

/**
 * Fills the database behind `db` with the demo workspace: the same rows, in the same
 * shape, as legacy/scripts/seed-demo.js. Throws SeedRefusal on a database that has
 * tickets, or users when `allowExistingUsers` is not set; nothing is written then.
 * Ids and timestamps differ run to run (random UUIDs, dates relative to now).
 */
export function seedDemo(
  db: OpenDatabase,
  registry: ProjectsRegistry,
  options: { allowExistingUsers?: boolean } = {},
): SeedSummary {
  const boards: Record<string, { project: ProjectConfig; board: BoardConfig }> = {};
  for (const { project, board } of registry.allBoards()) {
    boards[project.slug + '/' + board.slug] = { project, board };
  }
  for (const t of TICKETS) {
    const entry = boards[t.b];
    if (!entry) {
      throw new SeedRefusal(
        `projects.json has no board "${t.b}". The demo content assumes the stock projects.json.`,
      );
    }
    if (!entry.board.statuses.includes(t.status) || !entry.board.types.includes(t.type)) {
      throw new SeedRefusal(
        `"${t.title}" uses a status or type that board ${t.b} does not declare.`,
      );
    }
  }

  const existing = inspectTarget(db);
  if (existing.tickets > 0) {
    throw new SeedRefusal(
      `This database already has ${existing.tickets} ticket(s). Refusing to seed over real data. ` +
        'Point PM_DATA_DIR at an empty directory.',
    );
  }
  if (existing.users > 0 && !options.allowExistingUsers) {
    throw new SeedRefusal(
      `This database already has ${existing.users} user(s), so it is not a fresh data directory. ` +
        'Use an empty PM_DATA_DIR, or pass --allow-non-empty to add the demo workspace next to them.',
    );
  }

  const raw = db.raw;
  const hash = bcrypt.hashSync(DEMO_PASSWORD, BCRYPT_ROUNDS);

  raw.transaction(() => {
    // Board settings and key counters, the same rows the server writes at boot.
    for (const { project, board } of Object.values(boards)) {
      raw
        .prepare(
          `INSERT OR IGNORE INTO board_settings
        (project_slug, board_slug, flow, agile_enabled, wip_limits, definition_of_done, definition_of_ready)
        VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          project.slug,
          board.slug,
          board.flow,
          board.agile ? 1 : 0,
          JSON.stringify(board.wip_limits || {}),
          JSON.stringify(board.definition_of_done || []),
          JSON.stringify(board.definition_of_ready || []),
        );
      raw.prepare('INSERT OR IGNORE INTO counters (prefix, next) VALUES (?, 1)').run(board.prefix);
    }

    for (const u of USERS) {
      raw
        .prepare('INSERT OR IGNORE INTO users (email, name, password, is_admin) VALUES (?,?,?,?)')
        .run(emailOf(u.name), u.name, hash, u.admin ? 1 : 0);
    }

    // Sprints: two completed on the engineering board, one active, so velocity
    // and the burndown both have something to draw. One completed cycle on Support.
    const sprint: Record<string, string> = {};
    const addSprint = (
      h: string,
      b: string,
      name: string,
      status: string,
      startOff: number,
      endOff: number,
      createdAgo: number,
    ) => {
      const { project, board } = boards[b]!;
      sprint[h] = crypto.randomUUID();
      raw
        .prepare(
          `INSERT INTO sprints (id, project_slug, board_slug, name, kind, start_date, end_date, status, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          sprint[h],
          project.slug,
          board.slug,
          name,
          'sprint',
          day(startOff),
          day(endOff),
          status,
          stamp(createdAgo),
        );
    };
    addSprint('s12', 'food/eng', 'Sprint 12', 'completed', -36, -23, 37);
    addSprint('s13', 'food/eng', 'Sprint 13', 'completed', -22, -9, 23);
    addSprint('s14', 'food/eng', 'Sprint 14', 'active', -8, 6, 9);

    const keyOf: Record<string, string> = {};
    const counters: Record<string, number> = {};
    const insert = raw.prepare(`INSERT INTO tickets
      (project_slug, board_slug, key, title, type, status, assignee, parent_key, level, description,
       acceptance_criteria, points, appetite, sprint_id, blocked, blocker_reason, priority, labels, due_date,
       created_at, updated_at)
      VALUES (@project_slug,@board_slug,@key,@title,@type,@status,@assignee,@parent_key,@level,@description,
       @acceptance_criteria,@points,@appetite,@sprint_id,@blocked,@blocker_reason,@priority,@labels,@due_date,
       @created_at,@updated_at)`);

    for (const t of TICKETS) {
      const { project, board } = boards[t.b]!;
      counters[board.prefix] = (counters[board.prefix] || 0) + 1;
      const key = board.prefix + '-' + counters[board.prefix];
      keyOf[t.id] = key;
      insert.run({
        project_slug: project.slug,
        board_slug: board.slug,
        key,
        title: t.title,
        type: t.type,
        status: t.status,
        assignee: t.who ? emailOf(t.who) : null,
        parent_key: t.ep ? keyOf[t.ep] : null,
        level: board.agile ? t.level || 'task' : null,
        description: t.desc || null,
        acceptance_criteria: board.agile ? JSON.stringify(t.ac || []) : null,
        points: board.points ? (t.pts ?? null) : null,
        appetite: t.appetite || null,
        sprint_id: t.sp ? sprint[t.sp] : null,
        blocked: t.blocked ? 1 : 0,
        blocker_reason: t.blocked || null,
        priority: t.pri || null,
        labels: t.labels ? JSON.stringify(t.labels) : null,
        due_date: t.due !== undefined ? day(t.due) : null,
        created_at: stamp(t.made, 9),
        updated_at: stamp(t.ago, 14),
      });
    }
    for (const [prefix, n] of Object.entries(counters)) {
      raw.prepare('UPDATE counters SET next = ? WHERE prefix = ?').run(n + 1, prefix);
    }

    // Support gets one completed week so its velocity card has data.
    const sup = boards['food/support']!;
    sprint.w41 = crypto.randomUUID();
    raw
      .prepare(
        `INSERT INTO sprints (id, project_slug, board_slug, name, kind, start_date, end_date, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        sprint.w41,
        sup.project.slug,
        sup.board.slug,
        'Week 41',
        'sprint',
        day(-14),
        day(-8),
        'completed',
        stamp(15),
      );

    for (const [h, who, body, ago, hour] of COMMENTS) {
      raw
        .prepare(
          'INSERT INTO comments (ticket_key, author, body, source, created_at) VALUES (?,?,?,?,?)',
        )
        .run(keyOf[h], who, body, 'user', stamp(ago, hour));
    }
    // A bot comment and its matching GitHub link, the way a PR opening writes them.
    raw
      .prepare(
        "INSERT INTO comments (ticket_key, author, body, source, created_at) VALUES (?, 'GitHub', ?, 'system', ?)",
      )
      .run(
        keyOf.a5,
        'PR opened: https://github.com/northwind/food-app/pull/212 by maya-okafor. Moved to "Code Review".',
        stamp(1, 13),
      );
    raw
      .prepare(
        `INSERT INTO github_links (id, ticket_key, kind, repo, ref, url, actor, environment, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        crypto.randomUUID(),
        keyOf.a5,
        'pr',
        'northwind/food-app',
        'feat/group-order-summary',
        'https://github.com/northwind/food-app/pull/212',
        'maya-okafor',
        null,
        stamp(1, 13),
      );

    // Definition of Done progress: finished work is fully ticked, review is half way.
    const dod = DOD['food/eng']!;
    for (const t of TICKETS.filter((x) => x.b === 'food/eng' && x.level !== 'epic')) {
      const ticked =
        t.status === 'Done' ? 4 : t.status === 'QA' ? 3 : t.status === 'Code Review' ? 1 : 0;
      if (!ticked) continue;
      dod.forEach((item, i) =>
        raw
          .prepare('INSERT INTO ticket_dod (ticket_key, item, done) VALUES (?,?,?)')
          .run(keyOf[t.id], item, i < ticked ? 1 : 0),
      );
    }

    // Reference links on the epics, and a couple of project docs.
    const link = raw.prepare(
      'INSERT INTO ticket_links (id, ticket_key, title, url, author, created_at) VALUES (?,?,?,?,?,?)',
    );
    const TUNDE = 'Tunde Bakare';
    const PRIYA = 'Priya Nair';
    const CHLOE = 'Chloe Martin';
    link.run(
      crypto.randomUUID(),
      keyOf.e1,
      'Group ordering spec',
      'https://example.com/specs/group-ordering',
      MAYA,
      stamp(38),
    );
    link.run(
      crypto.randomUUID(),
      keyOf.e2,
      'Payments flow diagram',
      'https://example.com/specs/payments-flow',
      TUNDE,
      stamp(36),
    );
    link.run(
      crypto.randomUUID(),
      keyOf.e3,
      'Kitchen screen mockups',
      'https://example.com/design/kitchen-screen',
      PRIYA,
      stamp(30),
    );
    const doc = raw.prepare(
      'INSERT INTO project_docs (id, project_slug, title, kind, url, body, author, created_at) VALUES (?,?,?,?,?,?,?,?)',
    );
    doc.run(
      crypto.randomUUID(),
      'food',
      'Ordering API reference',
      'link',
      'https://example.com/docs/ordering-api',
      'Endpoints, auth and error codes.',
      TUNDE,
      stamp(30),
    );
    doc.run(
      crypto.randomUUID(),
      'food',
      'Brand and tone guide',
      'link',
      'https://example.com/docs/brand',
      null,
      CHLOE,
      stamp(28),
    );

    // One retro, created the way completing Sprint 13 would have created it.
    const retro = crypto.randomUUID();
    raw
      .prepare(
        'INSERT INTO retros (id, project_slug, board_slug, sprint_id, name, status, created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(retro, 'food', 'eng', sprint.s13, 'Retro: Sprint 13', 'open', stamp(9, 16));
    const card = raw.prepare(
      'INSERT INTO retro_cards (id, retro_id, column_name, body, author, ticket_key, created_at) VALUES (?,?,?,?,?,?,?)',
    );
    const cards: Array<[string, string, string, string | null]> = [
      ['well', 'Pairing on the tip bug cut review time in half', TUNDE, keyOf.a3 ?? null],
      ['well', 'The vendor menu import landed a day early', 'Sam Adeyemi', keyOf.a4 ?? null],
      ['didnt', 'Two tickets were carried over without being re-estimated', PRIYA, null],
      ['didnt', 'Staging was down for most of a day', 'Jonas Weber', null],
      ['actions', 'Re-estimate carried-over tickets at planning', MAYA, null],
      ['actions', 'Add a staging health check to the stand-up', 'Sam Adeyemi', null],
    ];
    for (const [col, body, who, tk] of cards) {
      card.run(crypto.randomUUID(), retro, col, body, who, tk, stamp(8, 11));
    }
  })();

  return {
    tickets: inspectTarget(db).tickets,
    users: USERS.length,
    sprints: 4,
    retros: 1,
    login: { email: emailOf(MAYA), password: DEMO_PASSWORD },
  };
}
