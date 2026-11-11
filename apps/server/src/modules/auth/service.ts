import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { User } from '@officepm/shared';
import type { AppContext, JsonBody } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, HttpError } from '../../http/errors.js';

const SESSION_DAYS = 7;
export const BCRYPT_ROUNDS = 10;

export interface LoginResult {
  sid: string;
  expires: Date;
  user: User;
}

export function createAuthService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { users, sessions } = schema;

  return {
    async login(body: JsonBody): Promise<LoginResult> {
      const { email, password } = body;
      if (!email || !password) throw badRequest('email and password required');
      const user = orm
        .select()
        .from(users)
        .where(eq(users.email, String(email).toLowerCase().trim()))
        .get();
      if (!user || !(await bcrypt.compare(password as string, user.password))) {
        throw new HttpError(401, 'invalid email or password');
      }
      const sid = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
      orm
        .insert(sessions)
        .values({ id: sid, user_id: user.id, expires_at: expires.toISOString() })
        .run();
      return {
        sid,
        expires,
        user: { id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin },
      };
    },

    logout(sid: string | undefined): void {
      if (sid) orm.delete(sessions).where(eq(sessions.id, sid)).run();
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
