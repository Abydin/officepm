// What the server accepts on the wire, as Zod schemas. These are looser than the
// form schemas in entities.ts on purpose: they pin the TYPE of every field so a
// wrong-typed value is a 400 instead of reaching SQLite, but they leave "is it
// present" and the value rules to the server's own checks, which v1's exact error
// messages come from and which run first. The server only reads the result to
// decide pass or fail; it never replaces the body with the parsed value.
import { z } from 'zod';
import { RETRO_COLUMNS, TicketCreateSchema } from './entities.js';
import { SprintKindSchema } from './flows.js';

/** Empty string means "not set" in v1's forms, so it stays allowed next to a date. */
const OptionalDate = z.union([z.literal(''), z.iso.date()]).nullish();

const TicketFields = TicketCreateSchema.omit({
  // Checked by validateTicketExtras with v1's fixed messages.
  priority: true,
  labels: true,
  due_date: true,
  // Loosened below.
  status: true,
  blocked: true,
  acceptance_criteria: true,
}).extend({
  status: z.string().nullish(),
  // v1 stored any truthy value as 1.
  blocked: z.union([z.boolean(), z.number()]).nullish(),
  acceptance_criteria: z.array(z.string()).nullish(),
});

export const TicketCreateRequestSchema = TicketFields;
export const TicketPatchRequestSchema = TicketFields.omit({
  project_slug: true,
  board_slug: true,
}).partial();

export const DodPatchRequestSchema = z.object({
  item: z.string(),
  done: z.union([z.boolean(), z.number()]).nullish(),
});

export const CommentRequestSchema = z.object({ body: z.string() });

export const LinkRequestSchema = z.object({ title: z.string(), url: z.string() });

export const DocRequestSchema = z.object({
  title: z.string(),
  kind: z.string(),
  url: z.string().nullish(),
  body: z.string().nullish(),
});

export const SprintCreateRequestSchema = z.object({
  name: z.string(),
  kind: SprintKindSchema.nullish(),
  start_date: OptionalDate,
  end_date: OptionalDate,
  status: z.enum(['planned', 'active', 'completed']).nullish(),
});

export const SprintPatchRequestSchema = z.object({
  name: z.string().nullish(),
  start_date: z.iso.date().nullish(),
  end_date: z.iso.date().nullish(),
  status: z.enum(['planned', 'active', 'completed']).nullish(),
});

export const RetroRequestSchema = z.object({
  name: z.string(),
  sprint_id: z.string().nullish(),
});

export const RetroCardRequestSchema = z.object({
  column: z.enum(RETRO_COLUMNS),
  body: z.string(),
  ticket_key: z.string().nullish(),
});

export const RetroCardPatchRequestSchema = z.object({ body: z.string().optional() });

export const UserCreateRequestSchema = z.object({
  email: z.string(),
  name: z.string(),
  password: z.string(),
  department: z.string().nullish(),
});

/** POST /api/tickets/:key/handoff. Which fields are required depends on the decision. */
export const HandoffRequestSchema = z.object({
  decision: z.string(),
  to_status: z.string().nullish(),
  from_status: z.string().nullish(),
  reason: z.string().nullish(),
  assignee_id: z.number().int().nullish(),
  department: z.string().nullish(),
  note: z.string().nullish(),
  attachment_ids: z.array(z.string()).nullish(),
});

export const SettingsPatchRequestSchema = z.object({
  wip_limits: z.record(z.string(), z.number()).optional(),
  definition_of_done: z.array(z.string()).optional(),
  definition_of_ready: z.array(z.string()).optional(),
});

/**
 * Checks a request body against one of the schemas above. Returns null when it
 * passes, else a one-line message naming the first bad field.
 */
export function firstRequestIssue(schema: z.ZodType, body: unknown): string | null {
  const result = schema.safeParse(body);
  if (result.success) return null;
  const issue = result.error.issues[0];
  if (!issue) return 'invalid request body';
  const field = issue.path.map(String).join('.');
  return field ? 'invalid ' + field + ': ' + issue.message : issue.message;
}

const OptionalText = z.string().nullish();

/** The three POST /api/github/* hooks share one loose shape. */
export const GithubHookRequestSchema = z.object({
  branch: OptionalText,
  title: OptionalText,
  commit_message: OptionalText,
  repo: OptionalText,
  ref: OptionalText,
  url: OptionalText,
  actor: OptionalText,
  environment: OptionalText,
  tag: OptionalText,
  changelog: z.union([z.string(), z.array(z.string())]).nullish(),
  commits: z.union([z.string(), z.array(z.string())]).nullish(),
});
