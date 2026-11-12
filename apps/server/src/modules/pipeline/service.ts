import crypto from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  DEFAULT_PIPELINE,
  DepartmentSchema,
  isEpic,
  MAX_PIPELINE_PHASES,
  normalisePhaseEdit,
  PipelinePutSchema,
  type EpicPipeline,
  type PhaseMove,
  type PipelineConfig,
  type PipelinePhase,
} from '@officepm/shared';
import type { AppContext, JsonBody } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';
import { createRelations } from '../tickets/relations.js';
import { serializeTicket, type TicketRow } from '../tickets/serialize.js';

/** An epic is a ticket whose level or type says so (agile boards use level, others type). */
export const isEpicRow = (row: { level: string | null; type: string }) => isEpic(row);

export function createPipelineService(ctx: AppContext) {
  const { orm, raw } = ctx.db;
  const { tickets, projectPhases, ticketHandoffs, handoffRecipients, users } = schema;
  const { projects, events } = ctx;
  const relations = createRelations(ctx);

  const requireProject = (slug: string) => {
    if (!projects.findProject(slug)) throw notFound('project not found');
  };

  function config(slug: string): PipelineConfig {
    const rows = orm
      .select()
      .from(projectPhases)
      .where(eq(projectPhases.project_slug, slug))
      .orderBy(projectPhases.position)
      .all();
    if (!rows.length) {
      return { configured: false, phases: DEFAULT_PIPELINE.map((p) => ({ ...p })) };
    }
    return {
      configured: true,
      phases: rows.map((r) => ({ name: r.name, department: r.department })),
    };
  }

  const phasesOf = (slug: string): PipelinePhase[] => config(slug).phases;

  const epicChildren = (epicKey: string) =>
    orm
      .select()
      .from(tickets)
      .where(eq(tickets.parent_key, epicKey))
      .all()
      .filter((t) => !t.subticket_of);

  const requireEpic = (key: string): TicketRow => {
    const row = orm.select().from(tickets).where(eq(tickets.key, key)).get();
    if (!row) throw notFound('ticket not found');
    if (!isEpicRow(row)) throw conflict('only an epic has a pipeline');
    return row;
  };

  function history(key: string): PhaseMove[] {
    const rows = orm
      .select()
      .from(ticketHandoffs)
      .where(
        and(
          eq(ticketHandoffs.ticket_key, key),
          inArray(ticketHandoffs.kind, ['phase', 'phase_complete']),
        ),
      )
      .orderBy(sql`ticket_handoffs.created_at, ticket_handoffs.rowid`)
      .all();
    if (!rows.length) return [];
    const recipients = orm
      .select({ handoff_id: handoffRecipients.handoff_id, name: users.name })
      .from(handoffRecipients)
      .innerJoin(users, eq(users.id, handoffRecipients.user_id))
      .where(
        inArray(
          handoffRecipients.handoff_id,
          rows.map((r) => r.id),
        ),
      )
      .all();
    return rows.map((r) => ({
      id: r.id,
      decision: r.decision as 'approve' | 'reject',
      from_phase: r.from_status,
      to_phase: r.kind === 'phase_complete' ? null : r.to_status,
      completed: r.kind === 'phase_complete',
      reason: r.reason,
      note: r.note,
      from_name: r.from_name,
      to_names: recipients.filter((x) => x.handoff_id === r.id).map((x) => x.name),
      to_department: r.to_department,
      created_at: r.created_at ?? '',
    }));
  }

  /** True once the approval that finishes the feature happened and the epic is still done. */
  function isCompleted(epic: TicketRow): boolean {
    if (!epic.phase || !relations.isDone(epic)) return false;
    return history(epic.key).at(-1)?.completed === true;
  }

  return {
    config,
    phasesOf,
    isCompleted,

    /** How many tickets under the epic carry this phase tag and are not finished. */
    openInPhase(epic: TicketRow, phase: string): number {
      return epicChildren(epic.key).filter((t) => t.phase === phase && !relations.isDone(t)).length;
    },

    /**
     * Checks the pipeline tags on a ticket body against the ticket's project. Returns the
     * columns to write (only the keys that were sent). A phase on an epic is refused: it moves
     * by handoff, which keeps the history and the gate.
     */
    normaliseTags(
      projectSlug: string,
      b: JsonBody,
      epic: boolean,
    ): { phase?: string | null; department?: string | null } {
      const out: { phase?: string | null; department?: string | null } = {};
      if (b.phase !== undefined) {
        if (b.phase === null || b.phase === '') out.phase = null;
        else {
          if (typeof b.phase !== 'string') throw badRequest('phase must be a string');
          const names = phasesOf(projectSlug).map((p) => p.name);
          const match = names.find(
            (n) => n.toLowerCase() === (b.phase as string).trim().toLowerCase(),
          );
          if (!match) throw badRequest('phase must be one of: ' + names.join(', '));
          out.phase = match;
        }
        if (epic && out.phase !== undefined) {
          throw conflict('an epic moves between phases by handoff, not by editing it');
        }
      }
      if (b.department !== undefined) {
        if (b.department === null || b.department === '') out.department = null;
        else {
          const parsed = DepartmentSchema.safeParse(b.department);
          if (!parsed.success) throw badRequest('department ' + parsed.error.issues[0]?.message);
          out.department = parsed.data;
        }
      }
      return out;
    },

    /** PUT: replace the project's whole list. Removing a phase anything uses is refused. */
    put(slug: string, b: JsonBody): PipelineConfig {
      requireProject(slug);
      requireShape(PipelinePutSchema, b);
      const input = PipelinePutSchema.parse(b);
      if (input.phases.length < 1) throw badRequest('a pipeline needs at least one phase');
      if (input.phases.length > MAX_PIPELINE_PHASES) {
        throw badRequest('a pipeline has at most ' + MAX_PIPELINE_PHASES + ' phases');
      }
      const current = phasesOf(slug).map((p) => p.name);
      const edit = normalisePhaseEdit(input, current, DepartmentSchema);
      if (!edit.ok) throw badRequest(edit.message);

      const kept = new Set(edit.entries.map((e) => e.was));
      const removed = current.filter((n) => !kept.has(n));
      for (const name of removed) {
        const inUse = orm
          .select({ n: sql<number>`count(*)` })
          .from(tickets)
          .where(and(eq(tickets.project_slug, slug), eq(tickets.phase, name)))
          .get()?.n;
        if (inUse) {
          throw conflict(
            '"' +
              name +
              '" is still used by ' +
              inUse +
              (inUse === 1 ? ' ticket' : ' tickets') +
              ': move them to another phase first',
          );
        }
      }
      const renames = edit.entries.filter((e) => e.was !== e.name);

      raw.transaction(() => {
        if (renames.length) {
          // One statement, so swapping two names cannot trip over itself.
          const cases = renames.map(() => 'WHEN ? THEN ?').join(' ');
          raw
            .prepare(
              `UPDATE tickets SET phase = CASE phase ${cases} END
               WHERE project_slug = ? AND phase IN (${renames.map(() => '?').join(',')})`,
            )
            .run(...renames.flatMap((r) => [r.was, r.name]), slug, ...renames.map((r) => r.was));
        }
        orm.delete(projectPhases).where(eq(projectPhases.project_slug, slug)).run();
        edit.entries.forEach((e, position) => {
          orm
            .insert(projectPhases)
            .values({
              id: crypto.randomUUID(),
              project_slug: slug,
              name: e.name,
              department: e.department,
              position,
            })
            .run();
        });
      })();
      events.broadcast('pipeline.changed', { project_slug: slug });
      return config(slug);
    },

    /** The epic's stepper: every phase, where it is, and how many tagged tickets are done. */
    forEpic(key: string): EpicPipeline {
      const epic = requireEpic(key);
      const phases = phasesOf(epic.project_slug);
      const children = epicChildren(key);
      const inUse = epic.phase !== null;
      return {
        in_use: inUse,
        current: epic.phase,
        completed: isCompleted(epic),
        phases: phases.map((p) => {
          const tagged = children.filter((c) => c.phase === p.name);
          return {
            ...p,
            total: tagged.length,
            done: tagged.filter((c) => relations.isDone(c)).length,
          };
        }),
        history: inUse ? history(key) : [],
      };
    },

    /** Starts an epic on its project's pipeline, at the first phase. Nothing is written for the project. */
    start(key: string): EpicPipeline {
      const epic = requireEpic(key);
      if (epic.phase !== null) throw conflict('this feature is already on its pipeline');
      const first = phasesOf(epic.project_slug)[0]!;
      orm
        .update(tickets)
        .set({ phase: first.name, updated_at: sql`datetime('now')` })
        .where(eq(tickets.key, key))
        .run();
      events.broadcast(
        'ticket.updated',
        serializeTicket(orm.select().from(tickets).where(eq(tickets.key, key)).get()!),
      );
      return this.forEpic(key);
    },
  };
}

export type PipelineService = ReturnType<typeof createPipelineService>;
