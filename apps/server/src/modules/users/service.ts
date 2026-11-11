import bcrypt from 'bcrypt';
import { asc, eq, sql } from 'drizzle-orm';
import type { CreatedUser, UserListItem } from '@officepm/shared';
import type { AppContext, JsonBody } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { BCRYPT_ROUNDS } from '../auth/service.js';

export function createUserService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { users, sessions } = schema;

  return {
    list(): UserListItem[] {
      // v1 returns the raw 0/1 is_admin column on this route (unlike /api/me).
      return orm
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          is_admin: users.is_admin,
          created_at: users.created_at,
        })
        .from(users)
        .orderBy(asc(users.created_at))
        .all() as UserListItem[];
    },

    async create(b: JsonBody): Promise<CreatedUser> {
      if (!b.email || !b.name || !b.password) throw badRequest('email, name, password required');
      const email = String(b.email).toLowerCase().trim();
      if (orm.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
        throw conflict('a user with that email already exists');
      }
      const hash = await bcrypt.hash(b.password as string, BCRYPT_ROUNDS);
      const created = orm
        .insert(users)
        .values({ email, name: b.name as string, password: hash, is_admin: b.is_admin ? 1 : 0 })
        .returning({ id: users.id })
        .get();
      return { id: created.id, email, name: b.name as string, is_admin: !!b.is_admin };
    },

    async setPassword(id: string, b: JsonBody): Promise<void> {
      const password = b.password as string | undefined;
      if (!password || password.length < 6)
        throw badRequest('password must be at least 6 characters');
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      // The id is compared as SQLite does for v1's bound string, so the route
      // accepts exactly what v1 accepted.
      const info = orm
        .update(users)
        .set({ password: hash })
        .where(sql`${users.id} = ${id}`)
        .run();
      if (!info.changes) throw notFound('user not found');
      // A reset after a suspected compromise must kill stolen cookies too.
      orm
        .delete(sessions)
        .where(sql`${sessions.user_id} = ${id}`)
        .run();
    },
  };
}
