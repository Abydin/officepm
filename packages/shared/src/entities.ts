// API shapes, written from what the v1 server actually returns. They are NOT
// derived from the database tables: labels is JSON text in the table but an
// array here, blocked is 0/1 in the table but a boolean here, and the file
// shapes leave out stored_path on purpose.
import { z } from 'zod';
import { FlowIdSchema, SprintKindSchema } from './flows.js';

/** SQLite `datetime('now')` text, "YYYY-MM-DD HH:MM:SS". Kept as text, never a Date. */
const Timestamp = z.string();
/** Plain "YYYY-MM-DD" calendar date. */
const IsoDate = z.string();

// ---- users ------------------------------------------------------------------

/** Returned by POST /api/login and GET /api/me. */
export const UserSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  isAdmin: z.boolean(),
});
export type User = z.infer<typeof UserSchema>;

/** GET /api/users. v1 leaks the raw 0/1 column here, unlike /api/me. */
export const UserListItemSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  is_admin: z.number().int(),
  created_at: Timestamp,
});
export type UserListItem = z.infer<typeof UserListItemSchema>;

/** POST /api/users response: is_admin is a boolean here. */
export const CreatedUserSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  is_admin: z.boolean(),
});
export type CreatedUser = z.infer<typeof CreatedUserSchema>;

export const LoginInputSchema = z.object({ email: z.string(), password: z.string() });
export type LoginInput = z.infer<typeof LoginInputSchema>;

// ---- projects and boards ------------------------------------------------------

export const BoardSchema = z.object({
  slug: z.string(),
  name: z.string(),
  prefix: z.string(),
  icon: z.string(),
  flow: FlowIdSchema,
  statuses: z.array(z.string()),
  types: z.array(z.string()),
  points: z.boolean(),
  has_github: z.boolean(),
  agile: z.boolean(),
  wip_limits: z.record(z.string(), z.number()),
  done_statuses: z.array(z.string()),
});
export type Board = z.infer<typeof BoardSchema>;

export const ProjectSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  boards: z.array(BoardSchema),
});
export type Project = z.infer<typeof ProjectSchema>;

/** GET .../boards/:board/settings. */
export const BoardSettingsSchema = z.object({
  flow: FlowIdSchema,
  agile_enabled: z.boolean(),
  wip_limits: z.record(z.string(), z.number()),
  definition_of_done: z.array(z.string()),
  definition_of_ready: z.array(z.string()),
});
export type BoardSettings = z.infer<typeof BoardSettingsSchema>;

export const BoardSettingsPatchSchema = BoardSettingsSchema.pick({
  wip_limits: true,
  definition_of_done: true,
  definition_of_ready: true,
}).partial();
export type BoardSettingsPatch = z.infer<typeof BoardSettingsPatchSchema>;

// ---- tickets ------------------------------------------------------------------

export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export const PrioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof PrioritySchema>;

export const TicketSchema = z.object({
  id: z.number().int(),
  project_slug: z.string(),
  board_slug: z.string(),
  key: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  assignee: z.string().nullable(),
  qa_owner: z.string().nullable(),
  parent_key: z.string().nullable(),
  level: z.string().nullable(),
  description: z.string().nullable(),
  acceptance_criteria: z.array(z.string()),
  points: z.number().int().nullable(),
  appetite: z.string().nullable(),
  sprint_id: z.string().nullable(),
  blocked: z.boolean(),
  blocker_reason: z.string().nullable(),
  priority: PrioritySchema.nullable(),
  labels: z.array(z.string()),
  due_date: IsoDate.nullable(),
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type Ticket = z.infer<typeof TicketSchema>;

const LabelsInput = z.array(z.string().trim().min(1).max(24)).max(8);
const DueDateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(new Date(d + 'T00:00:00Z').getTime()), 'not a real date');

/** POST /api/tickets body. Which fields are honoured depends on the board. */
export const TicketCreateSchema = z.object({
  project_slug: z.string(),
  board_slug: z.string(),
  title: z.string().min(1),
  type: z.string(),
  status: z.string().optional(),
  assignee: z.string().nullish(),
  qa_owner: z.string().nullish(),
  parent_key: z.string().nullish(),
  level: z.string().nullish(),
  description: z.string().nullish(),
  acceptance_criteria: z.array(z.string()).optional(),
  points: z.number().int().nullish(),
  appetite: z.string().nullish(),
  sprint_id: z.string().nullish(),
  blocked: z.boolean().optional(),
  blocker_reason: z.string().nullish(),
  priority: PrioritySchema.nullish(),
  labels: LabelsInput.nullish(),
  due_date: DueDateInput.nullish(),
});
export type TicketCreate = z.infer<typeof TicketCreateSchema>;

/** PATCH /api/tickets/:key body: any subset of the patchable fields. */
export const TicketPatchSchema = TicketCreateSchema.omit({
  project_slug: true,
  board_slug: true,
}).partial();
export type TicketPatch = z.infer<typeof TicketPatchSchema>;

/** Entry of GET /api/tickets/:key/dod. */
export const DodItemSchema = z.object({ item: z.string(), done: z.boolean() });
export type DodItem = z.infer<typeof DodItemSchema>;

export const DodPatchSchema = z.object({ item: z.string().min(1), done: z.boolean().optional() });
export type DodPatch = z.infer<typeof DodPatchSchema>;

// ---- comments, links, files, docs ---------------------------------------------

export const CommentSchema = z.object({
  id: z.number().int(),
  ticket_key: z.string(),
  author: z.string(),
  body: z.string(),
  source: z.enum(['user', 'system']),
  created_at: Timestamp,
});
export type Comment = z.infer<typeof CommentSchema>;

export const GithubLinkSchema = z.object({
  id: z.string(),
  ticket_key: z.string(),
  kind: z.enum(['pr', 'deploy', 'release']),
  repo: z.string(),
  ref: z.string(),
  url: z.string().nullable(),
  actor: z.string().nullable(),
  environment: z.string().nullable(),
  created_at: Timestamp,
});
export type GithubLink = z.infer<typeof GithubLinkSchema>;

export const TicketLinkSchema = z.object({
  id: z.string(),
  ticket_key: z.string(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  created_at: Timestamp,
});
export type TicketLink = z.infer<typeof TicketLinkSchema>;

export const DocSchema = z.object({
  id: z.string(),
  project_slug: z.string(),
  title: z.string(),
  kind: z.string(),
  url: z.string().nullable(),
  body: z.string().nullable(),
  author: z.string(),
  created_at: Timestamp,
});
export type Doc = z.infer<typeof DocSchema>;

/** File listings never expose stored_path. */
export const ProjectFileSchema = z.object({
  id: z.string(),
  project_slug: z.string(),
  original_name: z.string(),
  size_bytes: z.number().int(),
  mime_type: z.string().nullable(),
  uploaded_by: z.string(),
  created_at: Timestamp,
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const TicketFileSchema = ProjectFileSchema.omit({ project_slug: true }).extend({
  ticket_key: z.string(),
});
export type TicketFile = z.infer<typeof TicketFileSchema>;

// ---- sprints, cycles, phases ---------------------------------------------------

export const SprintSchema = z.object({
  id: z.string(),
  project_slug: z.string(),
  board_slug: z.string(),
  name: z.string(),
  kind: SprintKindSchema,
  start_date: IsoDate.nullable(),
  end_date: IsoDate.nullable(),
  // 'planned' | 'active' | 'completed' in practice, but v1 stores whatever a
  // client posts, so the contract stays a plain string.
  status: z.string(),
  created_at: Timestamp,
});
export type Sprint = z.infer<typeof SprintSchema>;

export const BurndownSchema = z.object({
  sprint_id: z.string(),
  uses_points: z.boolean(),
  total_scope: z.number(),
  points: z.array(z.object({ date: IsoDate, ideal: z.number(), actual: z.number().nullable() })),
  insufficient_dates: z.boolean(),
});
export type Burndown = z.infer<typeof BurndownSchema>;

/** GET .../boards/:board/velocity. */
export const BoardVelocitySchema = z.object({
  uses_points: z.boolean(),
  sprints: z.array(
    z.object({ sprint_id: z.string(), name: z.string(), completed_scope: z.number() }),
  ),
  average_velocity: z.number().nullable(),
});
export type BoardVelocity = z.infer<typeof BoardVelocitySchema>;

// ---- retros ----------------------------------------------------------------------

export const RETRO_COLUMNS = ['well', 'didnt', 'actions'] as const;

export const RetroSchema = z.object({
  id: z.string(),
  project_slug: z.string(),
  board_slug: z.string(),
  sprint_id: z.string().nullable(),
  name: z.string(),
  status: z.string(),
  created_at: Timestamp,
});
export type Retro = z.infer<typeof RetroSchema>;

/** Output uses column_name; the create body calls the same thing `column`. */
export const RetroCardSchema = z.object({
  id: z.string(),
  retro_id: z.string(),
  column_name: z.enum(RETRO_COLUMNS),
  body: z.string(),
  author: z.string(),
  ticket_key: z.string().nullable(),
  created_at: Timestamp,
});
export type RetroCard = z.infer<typeof RetroCardSchema>;

export const RetroCardCreateSchema = z.object({
  column: z.enum(RETRO_COLUMNS),
  body: z.string().min(1),
  ticket_key: z.string().nullish(),
});
export type RetroCardCreate = z.infer<typeof RetroCardCreateSchema>;

/** GET /api/retros/:id. */
export const RetroWithCardsSchema = RetroSchema.extend({ cards: z.array(RetroCardSchema) });
export type RetroWithCards = z.infer<typeof RetroWithCardsSchema>;

// ---- overview and dashboard ------------------------------------------------------

/** One row of GET /api/overview (one per board). */
export const OverviewRowSchema = z.object({
  project: z.string(),
  project_slug: z.string(),
  board: z.string(),
  board_slug: z.string(),
  open: z.number().int(),
  in_progress: z.number().int(),
  done_7d: z.number().int(),
});
export type OverviewRow = z.infer<typeof OverviewRowSchema>;

export const DashboardBoardSchema = OverviewRowSchema.extend({
  flow: FlowIdSchema,
  prefix: z.string(),
  total: z.number().int(),
  done: z.number().int(),
});
export type DashboardBoard = z.infer<typeof DashboardBoardSchema>;

export const DashboardSprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_date: IsoDate.nullable(),
  end_date: IsoDate.nullable(),
  project: z.string(),
  project_slug: z.string(),
  board: z.string(),
  board_slug: z.string(),
  burndown: BurndownSchema.nullable(),
  velocity: z.object({
    uses_points: z.boolean(),
    sprints: z.array(
      z.object({
        name: z.string(),
        completed: z.number(),
        status: z.enum(['completed', 'active']),
      }),
    ),
    average: z.number().nullable(),
  }),
});
export type DashboardSprint = z.infer<typeof DashboardSprintSchema>;

export const ActivityItemSchema = z.object({
  kind: z.enum(['comment', 'status']),
  who: z.string().nullable(),
  key: z.string(),
  title: z.string().nullable(),
  text: z.string(),
  /** Present on comments only. */
  system: z.boolean().optional(),
  at: Timestamp,
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

/** GET /api/dashboard. */
export const DashboardSchema = z.object({
  totals: z.object({
    open: z.number().int(),
    in_progress: z.number().int(),
    done: z.number().int(),
    done_7d: z.number().int(),
    blocked: z.number().int(),
    overdue: z.number().int(),
  }),
  boards: z.array(DashboardBoardSchema),
  sprint: DashboardSprintSchema.nullable(),
  needs_me: z.array(TicketSchema.extend({ overdue: z.boolean() })),
  activity: z.array(ActivityItemSchema),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

/** Result of the three POST /api/github/* hooks. */
export const GithubHookResultSchema = z.object({
  ok: z.literal(true),
  matched: z.array(z.string()),
});
export type GithubHookResult = z.infer<typeof GithubHookResultSchema>;
