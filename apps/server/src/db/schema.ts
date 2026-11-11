// Drizzle table definitions for query typing. They mirror the v1 schema (tests/data-compat/frozen-v1/schema.js)
// exactly (names, columns, defaults, indexes) but are never used to create
// tables: migrations/0000-baseline.ts owns the DDL, and a test compares the two.
//
// Columns stay raw on purpose. Dates are TEXT, labels and acceptance_criteria are
// JSON text, blocked and is_admin are 0/1. The mapping to API shapes lives above
// this layer, so the DB shape cannot leak into the contract.
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const now = sql`(datetime('now'))`;

export const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  password: text('password').notNull(),
  is_admin: integer('is_admin').default(0),
  created_at: text('created_at').default(now),
  // Added after v1 by migration 0001. Optional team name, set by an admin.
  department: text('department'),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  user_id: integer('user_id').notNull(),
  expires_at: text('expires_at').notNull(),
  created_at: text('created_at').default(now),
});

export const counters = sqliteTable('counters', {
  prefix: text('prefix').primaryKey(),
  next: integer('next').notNull().default(1),
});

export const tickets = sqliteTable(
  'tickets',
  {
    id: integer('id').primaryKey(),
    project_slug: text('project_slug').notNull(),
    board_slug: text('board_slug').notNull(),
    key: text('key').notNull().unique(),
    title: text('title').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    assignee: text('assignee'),
    qa_owner: text('qa_owner'),
    parent_key: text('parent_key'),
    level: text('level'),
    description: text('description'),
    acceptance_criteria: text('acceptance_criteria'),
    points: integer('points'),
    appetite: text('appetite'),
    sprint_id: text('sprint_id'),
    blocked: integer('blocked').default(0),
    blocker_reason: text('blocker_reason'),
    created_at: text('created_at').default(now),
    updated_at: text('updated_at').default(now),
    // Added after v1.0 by guarded ALTER TABLE, so they come last, like in the file.
    priority: text('priority'),
    labels: text('labels'),
    due_date: text('due_date'),
  },
  (t) => [
    index('idx_tickets_board').on(t.project_slug, t.board_slug),
    index('idx_tickets_assignee').on(t.assignee),
    index('idx_tickets_sprint').on(t.sprint_id),
    index('idx_tickets_parent').on(t.parent_key),
  ],
);

export const comments = sqliteTable(
  'comments',
  {
    id: integer('id').primaryKey(),
    ticket_key: text('ticket_key').notNull(),
    author: text('author').notNull(),
    body: text('body').notNull(),
    source: text('source').default('user'),
    created_at: text('created_at').default(now),
  },
  (t) => [index('idx_comments_ticket').on(t.ticket_key)],
);

export const githubLinks = sqliteTable(
  'github_links',
  {
    id: text('id').primaryKey(),
    ticket_key: text('ticket_key').notNull(),
    kind: text('kind').notNull(),
    repo: text('repo').notNull(),
    ref: text('ref').notNull(),
    url: text('url'),
    actor: text('actor'),
    environment: text('environment'),
    created_at: text('created_at').default(now),
  },
  (t) => [index('idx_github_links_ticket').on(t.ticket_key)],
);

export const projectDocs = sqliteTable('project_docs', {
  id: text('id').primaryKey(),
  project_slug: text('project_slug').notNull(),
  title: text('title').notNull(),
  kind: text('kind').notNull(),
  url: text('url'),
  body: text('body'),
  author: text('author').notNull(),
  created_at: text('created_at').default(now),
});

export const projectFiles = sqliteTable('project_files', {
  id: text('id').primaryKey(),
  project_slug: text('project_slug').notNull(),
  original_name: text('original_name').notNull(),
  // Absolute in every row v1 wrote. Resolve with resolveStoredPath, never rewrite.
  stored_path: text('stored_path').notNull(),
  size_bytes: integer('size_bytes').notNull(),
  mime_type: text('mime_type'),
  uploaded_by: text('uploaded_by').notNull(),
  created_at: text('created_at').default(now),
});

export const ticketLinks = sqliteTable('ticket_links', {
  id: text('id').primaryKey(),
  ticket_key: text('ticket_key').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  author: text('author').notNull(),
  created_at: text('created_at').default(now),
});

export const ticketFiles = sqliteTable('ticket_files', {
  id: text('id').primaryKey(),
  ticket_key: text('ticket_key').notNull(),
  original_name: text('original_name').notNull(),
  stored_path: text('stored_path').notNull(),
  size_bytes: integer('size_bytes').notNull(),
  mime_type: text('mime_type'),
  uploaded_by: text('uploaded_by').notNull(),
  created_at: text('created_at').default(now),
});

export const sprints = sqliteTable('sprints', {
  id: text('id').primaryKey(),
  project_slug: text('project_slug').notNull(),
  board_slug: text('board_slug').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  start_date: text('start_date'),
  end_date: text('end_date'),
  status: text('status').default('planned'),
  created_at: text('created_at').default(now),
});

export const retros = sqliteTable('retros', {
  id: text('id').primaryKey(),
  project_slug: text('project_slug').notNull(),
  board_slug: text('board_slug').notNull(),
  sprint_id: text('sprint_id'),
  name: text('name').notNull(),
  status: text('status').default('open'),
  created_at: text('created_at').default(now),
});

export const retroCards = sqliteTable('retro_cards', {
  id: text('id').primaryKey(),
  retro_id: text('retro_id').notNull(),
  column_name: text('column_name').notNull(),
  body: text('body').notNull(),
  author: text('author').notNull(),
  ticket_key: text('ticket_key'),
  created_at: text('created_at').default(now),
});

export const boardSettings = sqliteTable(
  'board_settings',
  {
    project_slug: text('project_slug').notNull(),
    board_slug: text('board_slug').notNull(),
    flow: text('flow').default('kanban'),
    agile_enabled: integer('agile_enabled').default(0),
    wip_limits: text('wip_limits'),
    definition_of_done: text('definition_of_done'),
    definition_of_ready: text('definition_of_ready'),
  },
  (t) => [primaryKey({ columns: [t.project_slug, t.board_slug] })],
);

export const ticketDod = sqliteTable(
  'ticket_dod',
  {
    ticket_key: text('ticket_key').notNull(),
    item: text('item').notNull(),
    done: integer('done').default(0),
  },
  (t) => [primaryKey({ columns: [t.ticket_key, t.item] })],
);

export const ticketHandoffs = sqliteTable(
  'ticket_handoffs',
  {
    id: text('id').primaryKey(),
    ticket_key: text('ticket_key').notNull(),
    decision: text('decision').notNull(),
    from_status: text('from_status').notNull(),
    to_status: text('to_status').notNull(),
    reason: text('reason'),
    note: text('note'),
    from_email: text('from_email').notNull(),
    from_name: text('from_name').notNull(),
    to_assignee: text('to_assignee'),
    to_department: text('to_department'),
    attachment_ids: text('attachment_ids'),
    comment_id: integer('comment_id'),
    created_at: text('created_at').default(now),
  },
  (t) => [
    index('idx_ticket_handoffs_ticket').on(t.ticket_key),
    index('idx_ticket_handoffs_assignee').on(t.to_assignee),
  ],
);

export const handoffReads = sqliteTable(
  'handoff_reads',
  {
    handoff_id: text('handoff_id').notNull(),
    user_id: integer('user_id').notNull(),
    read_at: text('read_at').default(now),
  },
  (t) => [primaryKey({ columns: [t.handoff_id, t.user_id] })],
);

/** Additive bookkeeping table owned by migrate.ts. v1 never reads or writes it. */
export const officepmMigrations = sqliteTable('_officepm_migrations', {
  name: text('name').primaryKey(),
  applied_at: text('applied_at').notNull().default(now),
});
