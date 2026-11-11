import { and, asc, desc, eq, inArray, isNotNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { ActivityItem, Dashboard, OverviewRow, Ticket } from '@officepm/shared';
import type { AppContext, SessionUser } from '../../context.js';
import { schema } from '../../db/index.js';
import { todayIso } from '../../lib/dates.js';
import { countWhere } from '../../lib/rows.js';
import type { BoardConfig, ProjectConfig } from '../../projects-config.js';
import type { SprintService } from '../sprints/service.js';
import { serializeTicket } from '../tickets/serialize.js';

type VelocityEntry = { name: string; completed: number; status: 'completed' | 'active' };

const DASHBOARD_TTL_MS = 5000;
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function createReportService(ctx: AppContext, sprintService: SprintService) {
  const { orm } = ctx.db;
  const { tickets, sprints, comments } = schema;
  const { projects } = ctx;

  const onBoard = (project: ProjectConfig, board: BoardConfig) =>
    and(eq(tickets.project_slug, project.slug), eq(tickets.board_slug, board.slug));
  const isDone = (board: BoardConfig) => inArray(tickets.status, board.done_statuses);
  const notDone = (board: BoardConfig) => notInArray(tickets.status, board.done_statuses);

  // PRD 6.11 does not define "Open" vs "In Progress": the first status is "not
  // started yet", the done statuses are "Done", everything else is in progress.
  function boardCounts(project: ProjectConfig, board: BoardConfig) {
    const total = countWhere(orm, tickets, onBoard(project, board));
    const done = countWhere(orm, tickets, and(onBoard(project, board), isDone(board)));
    const open = countWhere(
      orm,
      tickets,
      and(onBoard(project, board), eq(tickets.status, board.statuses[0] as string)),
    );
    return { total, done, open, inProgress: total - done - open };
  }

  const done7d = (project: ProjectConfig, board: BoardConfig) =>
    countWhere(
      orm,
      tickets,
      and(
        onBoard(project, board),
        isDone(board),
        sql`${tickets.updated_at} >= datetime('now', '-7 days')`,
      ),
    );

  function computeDashboard(user: SessionUser): Dashboard {
    const boards: Dashboard['boards'] = [];
    const totals = { open: 0, in_progress: 0, done: 0, done_7d: 0, blocked: 0, overdue: 0 };
    const today = todayIso();

    for (const { project, board } of projects.allBoards()) {
      const counts = boardCounts(project, board);
      const recentDone = done7d(project, board);
      const blocked = countWhere(
        orm,
        tickets,
        and(onBoard(project, board), eq(tickets.blocked, 1), notDone(board)),
      );
      const overdue = countWhere(
        orm,
        tickets,
        and(
          onBoard(project, board),
          isNotNull(tickets.due_date),
          lt(tickets.due_date, today),
          notDone(board),
        ),
      );
      boards.push({
        project: project.name,
        project_slug: project.slug,
        board: board.name,
        board_slug: board.slug,
        flow: board.flow,
        prefix: board.prefix,
        total: counts.total,
        open: counts.open,
        in_progress: counts.inProgress,
        done: counts.done,
        done_7d: recentDone,
      });
      totals.open += counts.open;
      totals.in_progress += counts.inProgress;
      totals.done += counts.done;
      totals.done_7d += recentDone;
      totals.blocked += blocked;
      totals.overdue += overdue;
    }

    // Active sprint: the one ending soonest, with its board's completed sprints as velocity.
    let sprint: Dashboard['sprint'] = null;
    const active = orm
      .select()
      .from(sprints)
      .where(eq(sprints.status, 'active'))
      .orderBy(asc(sprints.end_date))
      .get();
    if (active) {
      const found = projects.findBoard(active.project_slug, active.board_slug);
      if (found) {
        const usePoints = !!found.board.points;
        const scopeDone = (id: string) =>
          orm
            .select()
            .from(tickets)
            .where(eq(tickets.sprint_id, id))
            .all()
            .filter((t) => found.board.done_statuses.includes(t.status))
            .reduce((sum, t) => sum + (usePoints ? t.points || 0 : 1), 0);
        const history = orm
          .select()
          .from(sprints)
          .where(
            and(
              eq(sprints.project_slug, active.project_slug),
              eq(sprints.board_slug, active.board_slug),
              eq(sprints.status, 'completed'),
            ),
          )
          .orderBy(asc(sprints.start_date))
          .all()
          .map((sp): VelocityEntry => ({
            name: sp.name,
            completed: scopeDone(sp.id),
            status: 'completed',
          }));
        const velocity = history.concat([
          { name: active.name, completed: scopeDone(active.id), status: 'active' },
        ]);
        sprint = {
          id: active.id,
          name: active.name,
          start_date: active.start_date,
          end_date: active.end_date,
          project: found.project.name,
          project_slug: active.project_slug,
          board: found.board.name,
          board_slug: active.board_slug,
          burndown: sprintService.computeBurndown(active),
          velocity: {
            uses_points: usePoints,
            sprints: velocity,
            average: history.length
              ? Math.round((history.reduce((a, h) => a + h.completed, 0) / history.length) * 10) /
                10
              : null,
          },
        };
      }
    }

    // Needs me: open tickets assigned to the current user, blocked and overdue first.
    const isDoneTicket = (t: typeof tickets.$inferSelect) => {
      const f = projects.findBoard(t.project_slug, t.board_slug);
      return !!f && f.board.done_statuses.includes(t.status);
    };
    const needsMe = orm
      .select()
      .from(tickets)
      .where(or(eq(tickets.assignee, user.email), eq(tickets.assignee, user.name)))
      .all()
      .filter((t) => !isDoneTicket(t))
      .map((t) => ({
        t,
        score:
          (t.blocked ? 0 : 4) +
          (t.due_date && t.due_date < today ? 0 : 2) +
          (t.priority ? (PRIORITY_RANK[t.priority] as number) / 4 : 0.9),
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
      .map(({ t }) => ({ ...serializeTicket(t), overdue: !!(t.due_date && t.due_date < today) }));

    // Activity: latest comments plus latest ticket updates, newest first.
    const recentComments: ActivityItem[] = orm
      .select({
        author: comments.author,
        body: comments.body,
        source: comments.source,
        at: comments.created_at,
        key: comments.ticket_key,
        title: tickets.title,
      })
      .from(comments)
      .leftJoin(tickets, eq(tickets.key, comments.ticket_key))
      .orderBy(desc(comments.created_at), desc(comments.id))
      .limit(8)
      .all()
      .map((c) => ({
        kind: 'comment' as const,
        who: c.author,
        key: c.key,
        title: c.title,
        text: c.body,
        system: c.source === 'system',
        at: c.at as string,
      }));
    const moves: ActivityItem[] = orm
      .select()
      .from(tickets)
      .orderBy(desc(tickets.updated_at))
      .limit(8)
      .all()
      .map((t) => ({
        kind: 'status' as const,
        who: t.assignee,
        key: t.key,
        title: t.title,
        text: t.status,
        at: t.updated_at as string,
      }));
    const activity = recentComments
      .concat(moves)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 10);

    return { totals, boards, sprint, needs_me: needsMe, activity };
  }

  return {
    overview(): OverviewRow[] {
      return projects.allBoards().map(({ project, board }) => {
        const counts = boardCounts(project, board);
        return {
          project: project.name,
          project_slug: project.slug,
          board: board.name,
          board_slug: board.slug,
          open: counts.open,
          in_progress: counts.inProgress,
          done_7d: done7d(project, board),
        };
      });
    },

    /** Several queries per board on a synchronous driver: cache each user's result briefly. */
    dashboard(user: SessionUser): Dashboard {
      const hit = ctx.dashboardCache.get(user.id);
      if (hit && Date.now() - hit.at < DASHBOARD_TTL_MS) return hit.body;
      const body = computeDashboard(user);
      if (ctx.dashboardCache.size > 200) ctx.dashboardCache.clear();
      ctx.dashboardCache.set(user.id, { at: Date.now(), body });
      return body;
    },

    /** Tickets assigned to the user by email, then those assigned by display name. */
    myTickets(user: SessionUser): Ticket[] {
      const assignedTo = (who: string) =>
        orm
          .select()
          .from(tickets)
          .where(eq(tickets.assignee, who))
          .orderBy(desc(tickets.updated_at))
          .all();
      return assignedTo(user.email)
        .concat(assignedTo(user.name))
        .filter((t, i, arr) => arr.findIndex((x) => x.key === t.key) === i)
        .map(serializeTicket);
    },
  };
}
