import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { and, eq, ne } from 'drizzle-orm';
import { PasswordChangeSchema, type User } from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { schema, type OpenDatabase } from '../../db/index.js';
import { badRequest, HttpError } from '../../http/errors.js';
import { LoginThrottle } from '../../http/throttle.js';
import { requireShape } from '../../http/validate.js';

const SESSION_DAYS = 7;
export const BCRYPT_ROUNDS = 10;

export interface LoginResult {
  sid: string;
  expires: Date;
  user: User;
}

// Compared against when the email is unknown, so a miss costs the same bcrypt
// round as a hit and response time does not reveal which emails have accounts.
let decoyHash: Promise<string> | undefined;
const decoy = () => (decoyHash ??= bcrypt.hash('decoy-' + crypto.randomUUID(), BCRYPT_ROUNDS));

/** A new session for a user. Used wherever someone is signed in: login and invite accept. */
export function issueSession(
  orm: Pick<OpenDatabase['orm'], 'insert'>,
  userId: number,
): SessionIssue {
  const sid = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  orm
    .insert(schema.sessions)
    .values({ id: sid, user_id: userId, expires_at: expires.toISOString() })
    .run();
  return { sid, expires };
}

export interface SessionIssue {
  sid: string;
  expires: Date;
}

/** Thrown when a client has used up its failed logins. Carries Retry-After seconds. */
export class TooManyAttempts extends HttpError {
  constructor(readonly retryAfter: number) {
    super(429, 'too many failed login attempts, try again later');
  }
}

export function createAuthService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { users, sessions } = schema;
  const throttle = ctx.loginThrottle ?? new LoginThrottle();

  return {
    async login(body: JsonBody, ip: string): Promise<LoginResult> {
      const { email, password } = body;
      if (!email || !password) throw badRequest('email and password required');
      // bcrypt compares strings; anything else is not a credential this API accepts.
      if (typeof email !== 'string' || typeof password !== 'string') {
        throw badRequest('email and password must be strings');
      }
      const address = email.toLowerCase().trim();
      // Counts this attempt as a failure in the same synchronous step as the check, so a
      // parallel burst cannot all pass before the first compare finishes. A right password
      // refunds it below; anything else, a throw included, leaves it counted.
      // The lookup is synchronous, so it cannot let a burst through; it tells the throttle
      // whether the email has an account, so made-up emails never create per-email state.
      const user = orm.select().from(users).where(eq(users.email, address)).get();
      const attempt = throttle.begin(ip, address, !!user);
      if (attempt.wait > 0) throw new TooManyAttempts(attempt.wait);

      // Async compare: bcrypt runs on the libuv pool, so the event loop keeps serving.
      const valid = await bcrypt.compare(password, user ? user.password : await decoy());
      // A deactivated account fails exactly like a wrong password: same status, same text, same
      // bcrypt cost, and the attempt stays counted (a refund would show the password was right).
      if (!user || !valid || user.deactivated_at) {
        throw new HttpError(401, 'invalid email or password');
      }
      attempt.success();
      const { sid, expires } = issueSession(orm, user.id);
      return {
        sid,
        expires,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: !!user.is_admin,
          mustChangePassword: !!user.must_change_password,
        },
      };
    },

    /**
     * Changes the signed-in user's own password. The current one must be right, and a wrong one
     * counts against the same throttle as a failed login (it is a password guess by whoever
     * holds the cookie). Every OTHER session of the user is deleted and their event streams
     * closed; the session making the request stays. Clears the forced-change flag.
     */
    async changePassword(
      user: SessionUser,
      currentSid: string,
      body: JsonBody,
      ip: string,
    ): Promise<void> {
      const { current_password: current, new_password: next } = body;
      if (typeof current !== 'string' || typeof next !== 'string' || !current || !next) {
        throw badRequest('current_password and new_password required');
      }
      requireShape(PasswordChangeSchema, body);
      const attempt = throttle.begin(ip, user.email, true);
      if (attempt.wait > 0) throw new TooManyAttempts(attempt.wait);
      const row = orm
        .select({ password: users.password })
        .from(users)
        .where(eq(users.id, user.id))
        .get();
      const valid = row ? await bcrypt.compare(current, row.password) : false;
      // 403, never 401: the web client treats any 401 as "the session is gone" and signs out.
      if (!valid) throw new HttpError(403, 'current password is incorrect');
      attempt.success();
      if (current === next) throw badRequest('new_password must differ from the current password');
      const hash = await bcrypt.hash(next, BCRYPT_ROUNDS);
      orm.transaction((tx) => {
        tx.update(users)
          .set({ password: hash, must_change_password: 0 })
          .where(eq(users.id, user.id))
          .run();
        tx.delete(sessions)
          .where(and(eq(sessions.user_id, user.id), ne(sessions.id, currentSid)))
          .run();
      });
      ctx.events.closeForUserExceptSession(user.id, currentSid);
    },

    logout(sid: string | undefined): void {
      if (sid) orm.delete(sessions).where(eq(sessions.id, sid)).run();
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
