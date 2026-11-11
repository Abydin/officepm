import crypto from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import {
  ALLOWED_SPRINT_KINDS,
  DEFAULT_SPRINT_DAYS,
  SprintCreateRequestSchema,
  SprintPatchRequestSchema,
  type Burndown,
  type BoardVelocity,
  type Sprint,
  type SprintKind,
} from '@officepm/shared';
import type { AppContext, JsonBody } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';
import { addDaysIso, DAY_MS, todayIso } from '../../lib/dates.js';

type SprintRow = typeof schema.sprints.$inferSelect;
type TicketRow = typeof schema.tickets.$inferSelect;

export function createSprintService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { sprints, tickets, retros } = schema;
  const { projects, events } = ctx;

  const byId = (id: string) => orm.select().from(sprints).where(eq(sprints.id, id)).get();
  const activeOn = (project: string, board: string) =>
    and(
      eq(sprints.project_slug, project),
      eq(sprints.board_slug, board),
      eq(sprints.status, 'active'),
    );

  /** Points if the board tracks them, else a ticket count. */
  const scopeOf = (usePoints: boolean) => (t: TicketRow) => (usePoints ? t.points || 0 : 1);
  const ticketsOf = (sprintId: string) =>
    orm.select().from(tickets).where(eq(tickets.sprint_id, sprintId)).all();

  // Burndown data (6.9). There is no daily-snapshot table, so "actual remaining"
  // per day is approximated from each ticket's updated_at as a stand-in for the
  // day it was marked done: good enough for an inline SVG, not audit-grade.
  // "ideal" is a straight line from full scope at start_date to zero at end_date.
  function computeBurndown(sprint: SprintRow): Burndown | null {
    const found = projects.findBoard(sprint.project_slug, sprint.board_slug);
    if (!found) return null;
    const usePoints = !!found.board.points;
    const scope = scopeOf(usePoints);
    const rows = ticketsOf(sprint.id);
    const totalScope = rows.reduce((sum, t) => sum + scope(t), 0);

    if (!sprint.start_date || !sprint.end_date) {
      return {
        sprint_id: sprint.id,
        uses_points: usePoints,
        total_scope: totalScope,
        points: [],
        insufficient_dates: true,
      };
    }

    const start = new Date(sprint.start_date + 'T00:00:00Z');
    const end = new Date(sprint.end_date + 'T00:00:00Z');
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const plotEnd = sprint.status === 'completed' ? end : today < end ? end : today;
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));

    const points: Burndown['points'] = [];
    for (let d = new Date(start); d <= plotEnd; d = new Date(d.getTime() + DAY_MS)) {
      const dayIso = d.toISOString().slice(0, 10);
      const elapsed = Math.round((d.getTime() - start.getTime()) / DAY_MS);
      const ideal = d > end ? 0 : Math.max(0, Math.round(totalScope * (1 - elapsed / totalDays)));
      const doneByThisDay = rows.filter(
        (t) =>
          found.board.done_statuses.includes(t.status) &&
          t.updated_at &&
          t.updated_at.slice(0, 10) <= dayIso,
      );
      const remaining = totalScope - doneByThisDay.reduce((sum, t) => sum + scope(t), 0);
      points.push({ date: dayIso, ideal, actual: d <= today ? Math.max(0, remaining) : null });
    }
    return {
      sprint_id: sprint.id,
      uses_points: usePoints,
      total_scope: totalScope,
      points,
      insufficient_dates: false,
    };
  }

  return {
    computeBurndown,

    list: (project: string, board: string): Sprint[] =>
      orm
        .select()
        .from(sprints)
        .where(and(eq(sprints.project_slug, project), eq(sprints.board_slug, board)))
        .orderBy(desc(sprints.created_at))
        .all() as Sprint[],

    create(project: string, board: string, b: JsonBody): Sprint {
      const found = projects.findBoard(project, board);
      if (!found) throw badRequest('unknown project/board');
      if (!b.name) throw badRequest('name required');
      requireShape(SprintCreateRequestSchema, b);
      // The default kind follows the flow, but an explicit one is honoured so a
      // Shape Up board can create its cooldown (6.10).
      const allowed = ALLOWED_SPRINT_KINDS[found.board.flow];
      const kind = (b.kind as SprintKind) || (allowed[0] as SprintKind);
      if (!allowed.includes(kind)) {
        throw badRequest(
          'kind must be one of: ' + allowed.join(', ') + ' on a ' + found.board.flow + ' board',
        );
      }
      let start_date = (b.start_date as string) || null;
      let end_date = (b.end_date as string) || null;
      if (!start_date && !end_date) start_date = todayIso();
      if (start_date && !end_date) end_date = addDaysIso(start_date, DEFAULT_SPRINT_DAYS[kind]);
      if (
        b.status === 'active' &&
        orm.select({ id: sprints.id }).from(sprints).where(activeOn(project, board)).get()
      ) {
        throw conflict('another sprint/cycle is already active on this board');
      }
      const row = orm
        .insert(sprints)
        .values({
          id: crypto.randomUUID(),
          project_slug: project,
          board_slug: board,
          name: b.name as string,
          kind,
          start_date,
          end_date,
          status: (b.status as string) || 'planned',
        })
        .returning()
        .get();
      events.broadcast('sprint.created', row);
      return row as Sprint;
    },

    patch(id: string, b: JsonBody): Sprint {
      const existing = byId(id);
      if (!existing) throw notFound('sprint not found');
      requireShape(SprintPatchRequestSchema, b);
      if (b.status === 'active' && existing.status !== 'active') {
        const already = orm
          .select({ id: sprints.id })
          .from(sprints)
          .where(and(activeOn(existing.project_slug, existing.board_slug), ne(sprints.id, id)))
          .get();
        if (already) throw conflict('another sprint/cycle is already active on this board');
      }
      const status = (b.status as string) ?? existing.status;
      orm
        .update(sprints)
        .set({
          name: (b.name as string) ?? existing.name,
          start_date: (b.start_date as string) ?? existing.start_date,
          end_date: (b.end_date as string) ?? existing.end_date,
          status,
        })
        .where(eq(sprints.id, id))
        .run();
      // Completing a sprint creates its retro, once (6.9, 6.10).
      if (
        status === 'completed' &&
        existing.status !== 'completed' &&
        !orm.select({ id: retros.id }).from(retros).where(eq(retros.sprint_id, id)).get()
      ) {
        orm
          .insert(retros)
          .values({
            id: crypto.randomUUID(),
            project_slug: existing.project_slug,
            board_slug: existing.board_slug,
            sprint_id: id,
            name: existing.name + ' Retro',
          })
          .run();
      }
      const sprint = byId(id) as SprintRow;
      events.broadcast('sprint.updated', sprint);
      return sprint as Sprint;
    },

    remove(id: string): void {
      orm.delete(sprints).where(eq(sprints.id, id)).run();
      events.broadcast('sprint.deleted', { id });
    },

    burndown(id: string): Burndown {
      const sprint = byId(id);
      if (!sprint) throw notFound('sprint not found');
      const result = computeBurndown(sprint);
      if (!result) throw notFound('board not found');
      return result;
    },

    /** Average scope completed per COMPLETED sprint; null until there is one. */
    velocity(project: string, board: string): BoardVelocity {
      const found = projects.findBoard(project, board);
      if (!found) throw notFound('board not found');
      const usePoints = !!found.board.points;
      const scope = scopeOf(usePoints);
      const completed = orm
        .select()
        .from(sprints)
        .where(
          and(
            eq(sprints.project_slug, project),
            eq(sprints.board_slug, board),
            eq(sprints.status, 'completed'),
          ),
        )
        .all();
      const perSprint = completed.map((s) => ({
        sprint_id: s.id,
        name: s.name,
        completed_scope: ticketsOf(s.id)
          .filter((t) => found.board.done_statuses.includes(t.status))
          .reduce((sum, t) => sum + scope(t), 0),
      }));
      const average = perSprint.length
        ? Math.round(
            (perSprint.reduce((sum, s) => sum + s.completed_scope, 0) / perSprint.length) * 10,
          ) / 10
        : null;
      return { uses_points: usePoints, sprints: perSprint, average_velocity: average };
    },
  };
}

export type SprintService = ReturnType<typeof createSprintService>;
