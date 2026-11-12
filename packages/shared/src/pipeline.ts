// The feature pipeline: an ordered list of phases per project, and the rules for moving
// an epic (a "feature") along it. Shared by the server and the handoff dialog so the
// client offers exactly what the server accepts.
//
// Naming: a "phase" here is a stage of the pipeline (Product, Design, ...). It is not
// a sprint phase (features/sprints/phase-strip) and not a ticket status.
import { z } from 'zod';
import { SINGLE_LINE } from './entities.js';
import { HANDOFF_REASON_MAX } from './handoff.js';

export const MAX_PIPELINE_PHASES = 12;
export const PHASE_NAME_MAX = 40;

/** One short line, the same limits as a department name. */
export const PhaseNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PHASE_NAME_MAX)
  .regex(SINGLE_LINE, 'must be a single line');

/** Used for a project that has not configured a pipeline. Nothing is stored for it. */
export const DEFAULT_PIPELINE: readonly PipelinePhase[] = [
  { name: 'Product', department: null },
  { name: 'Design', department: null },
  { name: 'Engineering', department: null },
  { name: 'QA', department: null },
  { name: 'Release', department: null },
];

export const PipelinePhaseSchema = z.object({
  name: z.string(),
  /** A suggestion for who the work goes to, free text like a user's department. */
  department: z.string().nullable(),
});
export type PipelinePhase = z.infer<typeof PipelinePhaseSchema>;

/** GET /api/projects/:slug/pipeline. */
export const PipelineConfigSchema = z.object({
  /** False while the list is the built-in default and nothing is stored. */
  configured: z.boolean(),
  phases: z.array(PipelinePhaseSchema),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/**
 * PUT /api/projects/:slug/pipeline (admin). The whole list, in order. `was` names the
 * phase an entry used to be called, which is how a rename keeps its tickets.
 */
export const PipelinePutSchema = z.object({
  phases: z
    .array(
      z.object({
        name: z.string(),
        department: z.string().nullish(),
        was: z.string().nullish(),
      }),
    )
    .max(MAX_PIPELINE_PHASES),
});
export type PipelinePut = z.infer<typeof PipelinePutSchema>;

/** One phase of an epic's pipeline with how many of its tagged tickets are finished. */
export const EpicPhaseSchema = PipelinePhaseSchema.extend({
  done: z.number().int(),
  total: z.number().int(),
});
export type EpicPhase = z.infer<typeof EpicPhaseSchema>;

/** One move along the pipeline. Names only, never an email. */
export const PhaseMoveSchema = z.object({
  id: z.string(),
  decision: z.enum(['approve', 'reject']),
  from_phase: z.string(),
  /** Null when the move completed the feature. */
  to_phase: z.string().nullable(),
  completed: z.boolean(),
  reason: z.string().nullable(),
  note: z.string().nullable(),
  from_name: z.string(),
  to_names: z.array(z.string()),
  to_department: z.string().nullable(),
  created_at: z.string(),
});
export type PhaseMove = z.infer<typeof PhaseMoveSchema>;

/** GET /api/tickets/:key/pipeline. `in_use` is false for an epic that never started one. */
export const EpicPipelineSchema = z.object({
  in_use: z.boolean(),
  current: z.string().nullable(),
  completed: z.boolean(),
  phases: z.array(EpicPhaseSchema),
  history: z.array(PhaseMoveSchema),
});
export type EpicPipeline = z.infer<typeof EpicPipelineSchema>;

/** "2 tickets in Engineering are still open: confirm to move on anyway". */
export function openPhaseTicketsMessage(open: number, phase: string): string {
  return (
    open +
    (open === 1 ? ' ticket' : ' tickets') +
    ' in ' +
    phase +
    (open === 1 ? ' is' : ' are') +
    ' still open: confirm to move on anyway'
  );
}

export type PhasePlan =
  | { ok: true; decision: 'approve' | 'reject'; to: string | null; reason: string | null }
  | { ok: false; status: 400 | 409; message: string };

const refuse = (status: 400 | 409, message: string): PhasePlan => ({ ok: false, status, message });

/**
 * Where a phase handoff sends a feature, or why it cannot. Approve goes to a later phase
 * (default: the next); from the last phase it completes the feature (`to` is null).
 * Reject goes to an earlier phase (default: the previous) and needs a reason.
 */
export function planPhaseMove(
  names: readonly string[],
  from: string,
  input: { decision?: unknown; to_phase?: unknown; reason?: unknown },
): PhasePlan {
  const { decision } = input;
  if (decision !== 'approve' && decision !== 'reject') {
    return refuse(400, 'decision must be approve or reject');
  }
  const fromIdx = names.indexOf(from);
  if (fromIdx === -1) return refuse(409, 'the phase "' + from + '" is not part of this pipeline');

  const unset = input.to_phase === undefined || input.to_phase === null || input.to_phase === '';
  let to: string | null;
  if (unset) {
    if (decision === 'approve') to = names[fromIdx + 1] ?? null;
    else {
      const previous = names[fromIdx - 1];
      if (previous === undefined)
        return refuse(409, 'there is no earlier phase before "' + from + '"');
      to = previous;
    }
  } else {
    if (typeof input.to_phase !== 'string' || !names.includes(input.to_phase)) {
      return refuse(400, 'to_phase must be one of: ' + names.join(', '));
    }
    to = input.to_phase;
    const toIdx = names.indexOf(to);
    if (decision === 'approve' && toIdx <= fromIdx) {
      return refuse(400, 'approve must move to a later phase');
    }
    if (decision === 'reject' && toIdx >= fromIdx) {
      return refuse(400, 'reject must move to an earlier phase');
    }
  }

  let reason: string | null = null;
  if (decision === 'reject') {
    reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) return refuse(400, 'a reason is required when sending a feature back');
    if (reason.length > HANDOFF_REASON_MAX) {
      return refuse(400, 'reason must be ' + HANDOFF_REASON_MAX + ' characters or fewer');
    }
  }
  return { ok: true, decision, to, reason };
}

export interface PhaseEditEntry {
  name: string;
  department: string | null;
  was: string;
}

/**
 * Checks an edited list against the phases that exist now. Returns the normalised entries
 * or the first problem. Names are unique ignoring case, `was` must be a current phase and
 * used once.
 */
export function normalisePhaseEdit(
  input: PipelinePut,
  current: readonly string[],
  departmentSchema: z.ZodType<string>,
): { ok: true; entries: PhaseEditEntry[] } | { ok: false; message: string } {
  const entries: PhaseEditEntry[] = [];
  const names = new Set<string>();
  const wasSeen = new Set<string>();
  for (const [i, raw] of input.phases.entries()) {
    const name = PhaseNameSchema.safeParse(raw.name);
    if (!name.success)
      return { ok: false, message: `phase ${i + 1}: name ${name.error.issues[0]?.message}` };
    let department: string | null = null;
    if (raw.department !== undefined && raw.department !== null && raw.department !== '') {
      const dept = departmentSchema.safeParse(raw.department);
      if (!dept.success) {
        return {
          ok: false,
          message: `phase ${i + 1}: department ${dept.error.issues[0]?.message}`,
        };
      }
      department = dept.data;
    }
    const key = name.data.toLowerCase();
    if (names.has(key))
      return { ok: false, message: 'phase names must be different: "' + name.data + '"' };
    names.add(key);
    const was = raw.was ?? name.data;
    const existing = current.find((c) => c.toLowerCase() === was.toLowerCase());
    if (raw.was != null && !existing)
      return { ok: false, message: 'unknown phase to rename: "' + was + '"' };
    if (existing) {
      if (wasSeen.has(existing))
        return { ok: false, message: 'a phase can only be renamed once: "' + was + '"' };
      wasSeen.add(existing);
    }
    entries.push({ name: name.data, department, was: existing ?? name.data });
  }
  return { ok: true, entries };
}
