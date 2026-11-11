import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { User } from '@officepm/shared';
import type { AppContext, JsonBody } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, HttpError } from '../../http/errors.js';
import { LoginThrottle } from '../../http/throttle.js';

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
      const wait = throttle.retryAfter(ip, address);
      if (wait > 0) throw new TooManyAttempts(wait);

      const user = orm.select().from(users).where(eq(users.email, address)).get();
      // Async compare: bcrypt runs on the libuv pool, so the event loop keeps serving.
      const valid = await bcrypt.compare(password, user ? user.password : await decoy());
      if (!user || !valid) {
        throttle.recordFailure(ip, address);
        throw new HttpError(401, 'invalid email or password');
      }
      throttle.recordSuccess(address);
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
