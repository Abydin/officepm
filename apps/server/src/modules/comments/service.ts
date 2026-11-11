import { asc, eq } from 'drizzle-orm';
import type { Comment } from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, notFound } from '../../http/errors.js';

export function createCommentService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { comments, tickets } = schema;

  function insert(
    ticketKey: string,
    author: string,
    body: string,
    source: 'user' | 'system',
  ): Comment {
    const row = orm
      .insert(comments)
      .values({ ticket_key: ticketKey, author, body, source })
      .returning()
      .get();
    ctx.events.broadcast('comment.created', row);
    return row as Comment;
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
      return insert(ticketKey, user.name, b.body as string, 'user');
    },

    /** Written by the GitHub webhooks as "GitHub", flagged so the UI can style it. */
    addSystemComment: (ticketKey: string, body: string): Comment =>
      insert(ticketKey, 'GitHub', body, 'system'),
  };
}

export type CommentService = ReturnType<typeof createCommentService>;
