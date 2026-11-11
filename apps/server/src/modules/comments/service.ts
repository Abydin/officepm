import { asc, eq } from 'drizzle-orm';
import { CommentRequestSchema, type Comment } from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';

export function createCommentService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { comments, tickets } = schema;

  /** Writes the row without announcing it, for callers that announce after their own commit. */
  function record(
    ticketKey: string,
    author: string,
    body: string,
    source: Comment['source'],
  ): Comment {
    return orm
      .insert(comments)
      .values({ ticket_key: ticketKey, author, body, source })
      .returning()
      .get() as Comment;
  }

  const announce = (row: Comment): void => ctx.events.broadcast('comment.created', row);

  function insert(
    ticketKey: string,
    author: string,
    body: string,
    source: Comment['source'],
  ): Comment {
    const row = record(ticketKey, author, body, source);
    announce(row);
    return row;
  }

  return {
    list: (ticketKey: string): Comment[] =>
      orm
        .select()
        .from(comments)
        .where(eq(comments.ticket_key, ticketKey))
        .orderBy(asc(comments.created_at))
        .all() as Comment[],

    create(ticketKey: string, b: JsonBody, user: SessionUser): Comment {
      if (!orm.select({ key: tickets.key }).from(tickets).where(eq(tickets.key, ticketKey)).get()) {
        throw notFound('ticket not found');
      }
      if (!b.body) throw badRequest('body required');
      requireShape(CommentRequestSchema, b);
      return insert(ticketKey, user.name, b.body as string, 'user');
    },

    /**
     * Used by the handoff, which writes inside its own transaction: `record` stores
     * the comment, and `announce` tells the event stream once that transaction has committed.
     */
    record,
    announce,

    /** Written by the GitHub webhooks as "GitHub", flagged so the UI can style it. */
    addSystemComment: (ticketKey: string, body: string): Comment =>
      insert(ticketKey, 'GitHub', body, 'system'),
  };
}

export type CommentService = ReturnType<typeof createCommentService>;
