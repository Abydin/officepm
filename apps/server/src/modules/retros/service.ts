import crypto from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { RETRO_COLUMNS, type Retro, type RetroCard, type RetroWithCards } from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, notFound } from '../../http/errors.js';

export function createRetroService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { retros, retroCards } = schema;

  const retroById = (id: string) => orm.select().from(retros).where(eq(retros.id, id)).get();
  const cardOf = (retroId: string, cardId: string) =>
    orm
      .select()
      .from(retroCards)
      .where(and(eq(retroCards.id, cardId), eq(retroCards.retro_id, retroId)))
      .get();

  return {
    list: (project: string, board: string): Retro[] =>
      orm
        .select()
        .from(retros)
        .where(and(eq(retros.project_slug, project), eq(retros.board_slug, board)))
        .orderBy(desc(retros.created_at))
        .all() as Retro[],

    create(project: string, board: string, b: JsonBody): Retro {
      if (!b.name) throw badRequest('name required');
      return orm
        .insert(retros)
        .values({
          id: crypto.randomUUID(),
          project_slug: project,
          board_slug: board,
          sprint_id: (b.sprint_id as string) || null,
          name: b.name as string,
        })
        .returning()
        .get() as Retro;
    },

    get(id: string): RetroWithCards {
      const retro = retroById(id);
      if (!retro) throw notFound('retro not found');
      const cards = orm
        .select()
        .from(retroCards)
        .where(eq(retroCards.retro_id, id))
        .orderBy(asc(retroCards.created_at))
        .all() as RetroCard[];
      return { ...(retro as Retro), cards };
    },

    addCard(retroId: string, b: JsonBody, user: SessionUser): RetroCard {
      if (!retroById(retroId)) throw notFound('retro not found');
      if (!(RETRO_COLUMNS as readonly unknown[]).includes(b.column)) {
        throw badRequest('column must be well, didnt or actions');
      }
      if (!b.body) throw badRequest('body required');
      const card = orm
        .insert(retroCards)
        .values({
          id: crypto.randomUUID(),
          retro_id: retroId,
          column_name: b.column as string,
          body: b.body as string,
          author: user.name,
          ticket_key: (b.ticket_key as string) || null,
        })
        .returning()
        .get() as RetroCard;
      ctx.events.broadcast('retro.card.created', card);
      return card;
    },

    editCard(retroId: string, cardId: string, b: JsonBody): RetroCard {
      const card = cardOf(retroId, cardId);
      if (!card) throw notFound('card not found');
      orm
        .update(retroCards)
        .set({ body: (b.body as string) ?? card.body })
        .where(eq(retroCards.id, cardId))
        .run();
      return cardOf(retroId, cardId) as RetroCard;
    },

    removeCard(retroId: string, cardId: string): void {
      orm
        .delete(retroCards)
        .where(and(eq(retroCards.id, cardId), eq(retroCards.retro_id, retroId)))
        .run();
    },
  };
}
