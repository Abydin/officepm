import crypto from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { GithubHookRequestSchema, type GithubHookResult, type GithubLink } from '@officepm/shared';
import type { AppContext, JsonBody } from '../../context.js';
import { schema } from '../../db/index.js';
import { requireShape } from '../../http/validate.js';
import { safeUrlOrNull } from '../../lib/urls.js';
import type { BoardConfig } from '../../projects-config.js';
import type { CommentService } from '../comments/service.js';
import { serializeTicket } from '../tickets/serialize.js';
import { transitionViolation } from '../tickets/transitions.js';

/** What one hook does to a matched ticket. */
interface Transition {
  kind: 'pr' | 'deploy' | 'release';
  target: (board: BoardConfig) => string;
  repo: string;
  ref: string;
  url: unknown;
  actor: string;
  environment?: string;
  /** The sentence for the system comment; `outcome` says what happened to the ticket. */
  comment: (outcome: string) => string;
}

export function createGithubService(ctx: AppContext, commentService: CommentService) {
  const { orm } = ctx.db;
  const { tickets, githubLinks } = schema;
  const { projects, events } = ctx;

  /**
   * Moves every matched ticket on a has_github board, records the event, comments
   * and broadcasts. Tickets on boards without has_github are never touched by CI
   * (6.7), and keys with no ticket are skipped rather than failing the hook.
   */
  function apply(keys: string[], transition: (board: BoardConfig) => Transition): GithubHookResult {
    const matched: string[] = [];
    const skipped: { key: string; reason: string }[] = [];
    for (const key of keys) {
      const ticket = orm.select().from(tickets).where(eq(tickets.key, key)).get();
      if (!ticket) continue;
      const found = projects.findBoardByPrefix(ticket.key.split('-').slice(0, -1).join('-'));
      if (!found || !found.board.has_github) continue;
      const t = transition(found.board);
      const target = t.target(found.board);
      // CI moves tickets by the same rules as a person does. A refused move is
      // still recorded (the PR or deploy happened) and said so in a comment.
      const violation = transitionViolation(found.board, ticket.status, target);
      if (!violation) {
        orm
          .update(tickets)
          .set({ status: target, updated_at: sql`datetime('now')` })
          .where(eq(tickets.key, key))
          .run();
      }
      orm
        .insert(githubLinks)
        .values({
          id: crypto.randomUUID(),
          ticket_key: key,
          kind: t.kind,
          repo: t.repo,
          ref: t.ref,
          url: safeUrlOrNull(t.url),
          actor: t.actor,
          environment: t.environment ?? null,
        })
        .run();
      if (violation) {
        commentService.addSystemComment(key, t.comment('Not moved: ' + violation + '.'));
        skipped.push({ key, reason: violation });
        continue;
      }
      commentService.addSystemComment(key, t.comment('Moved to "' + target + '".'));
      events.broadcast(
        'ticket.updated',
        serializeTicket(orm.select().from(tickets).where(eq(tickets.key, key)).get()!),
      );
      matched.push(key);
    }
    return skipped.length ? { ok: true, matched, skipped } : { ok: true, matched };
  }

  const text = (v: unknown) => (v as string) || '';

  return {
    links: (key: string): GithubLink[] =>
      orm
        .select()
        .from(githubLinks)
        .where(eq(githubLinks.ticket_key, key))
        .orderBy(desc(githubLinks.created_at))
        .all() as GithubLink[],

    prOpened(b: JsonBody): GithubHookResult {
      requireShape(GithubHookRequestSchema, b);
      const keys = projects.extractTicketKeys(
        text(b.branch) + ' ' + text(b.title) + ' ' + text(b.commit_message),
      );
      return apply(keys, () => ({
        kind: 'pr',
        target: (board) =>
          board.statuses.find((s) => /code review/i.test(s)) || (board.statuses[0] as string),
        repo: (b.repo as string) || 'unknown',
        ref: (b.branch as string) || (b.ref as string) || '',
        url: b.url,
        actor: (b.actor as string) || 'github',
        comment: (outcome) =>
          'PR opened' +
          (b.url ? ': ' + b.url : '') +
          ' by ' +
          ((b.actor as string) || 'someone') +
          '. ' +
          outcome,
      }));
    },

    deploy(b: JsonBody): GithubHookResult {
      requireShape(GithubHookRequestSchema, b);
      const keys = projects.extractTicketKeys(
        text(b.branch) + ' ' + text(b.commit_message) + ' ' + text(b.ref),
      );
      const env = (b.environment as string) || 'staging';
      return apply(keys, () => ({
        kind: 'deploy',
        // Production lands in Done, anything else in the first QA or staging column.
        target: (board) =>
          env === 'production'
            ? board.statuses.find((s) => /done/i.test(s)) ||
              (board.statuses[board.statuses.length - 1] as string)
            : board.statuses.find((s) => /qa|staging/i.test(s)) ||
              (board.statuses[board.statuses.length - 1] as string),
        repo: (b.repo as string) || 'unknown',
        ref: (b.ref as string) || (b.branch as string) || '',
        url: b.url,
        actor: (b.actor as string) || 'github',
        environment: env,
        comment: (outcome) => 'Deployed to ' + env + (b.url ? ': ' + b.url : '') + '. ' + outcome,
      }));
    },

    release(b: JsonBody): GithubHookResult {
      requireShape(GithubHookRequestSchema, b);
      const changelog = b.changelog || b.commits || '';
      const keys = projects.extractTicketKeys(
        Array.isArray(changelog) ? changelog.join(' ') : String(changelog),
      );
      return apply(keys, () => ({
        kind: 'release',
        target: (board) => board.done_statuses[0] as string,
        repo: (b.repo as string) || 'unknown',
        ref: (b.tag as string) || '',
        url: b.url,
        actor: (b.actor as string) || 'github',
        comment: (outcome) => 'Included in release ' + ((b.tag as string) || '') + '. ' + outcome,
      }));
    },
  };
}
