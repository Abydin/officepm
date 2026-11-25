import bcrypt from 'bcrypt';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  DepartmentSchema,
  DepartmentSetSchema,
  UserCreateRequestSchema,
  firstRequestIssue,
  type CreatedUser,
  type DeactivationResult,
  type Person,
  type UserListItem,
} from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';
import { BCRYPT_ROUNDS } from '../auth/service.js';

/** A validated department as stored: trimmed, or null for none. */
function clean(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = DepartmentSchema.safeParse(value);
  if (!parsed.success) throw badRequest('department must be one short line of up to 40 characters');
  return parsed.data;
}

/** A user id from a URL. Anything that is not a plain number is a user that does not exist. */
function parseId(id: string): number {
  if (!/^\d{1,15}$/.test(id)) throw notFound('user not found');
  return Number(id);
}

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
          department: users.department,
          must_change_password: users.must_change_password,
          deactivated_at: users.deactivated_at,
        })
        .from(users)
        .orderBy(asc(users.created_at))
        .all() as UserListItem[];
    },

    /**
     * The handoff picker's list, readable by any signed-in user, so it holds only what the
     * picker needs: an opaque user id, the name and the department. Never an email or
     * anything else from the row. (The full user list, GET /api/users, stays admin-only.)
     * This list does not make emails unreachable: a handoff returns the chosen assignee's
     * email on the ticket, exactly as every v1 ticket already shows its assignee email.
     * v1 has no project membership, so there is nothing to narrow it by.
     * A deactivated person is left out: this list is for choosing someone NEW. They still
     * resolve on the tickets they already have, because those read the users table directly.
     */
    people(): Person[] {
      return orm
        .select({ id: users.id, name: users.name, department: users.department })
        .from(users)
        .where(isNull(users.deactivated_at))
        .orderBy(asc(users.name), asc(users.id))
        .all();
    },

    async create(b: JsonBody): Promise<CreatedUser> {
      if (!b.email || !b.name || !b.password) throw badRequest('email, name, password required');
      requireShape(UserCreateRequestSchema, b);
      const department = clean(b.department);
      const email = String(b.email).toLowerCase().trim();
      if (orm.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
        throw conflict('a user with that email already exists');
      }
      const hash = await bcrypt.hash(b.password as string, BCRYPT_ROUNDS);
      const created = orm
        .insert(users)
        .values({
          email,
          name: b.name as string,
          password: hash,
          is_admin: b.is_admin ? 1 : 0,
          department,
          // The admin chose this password and knows it, so the person picks their own first.
          must_change_password: 1,
        })
        .returning({ id: users.id })
        .get();
      return { id: created.id, email, name: b.name as string, is_admin: !!b.is_admin };
    },

    /** Admin only. Only null clears the department; an empty or blank string is a 400. */
    setDepartment(id: string, b: JsonBody): { id: number; department: string | null } {
      const issue = firstRequestIssue(DepartmentSetSchema, {
        department: b.department ?? undefined,
      });
      if (b.department === undefined || (issue && b.department !== null)) {
        throw badRequest(issue ?? 'department required (use null to clear it)');
      }
      const department = clean(b.department);
      const updated = orm
        .update(users)
        .set({ department })
        .where(sql`${users.id} = ${id}`)
        .returning({ id: users.id, department: users.department })
        .get();
      if (!updated) throw notFound('user not found');
      return updated;
    },

    async setPassword(id: string, b: JsonBody): Promise<void> {
      const password = b.password;
      if (typeof password !== 'string' || password.length < 6)
        throw badRequest('password must be at least 6 characters');
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      // The id is compared as SQLite does for v1's bound string, so the route
      // accepts exactly what v1 accepted.
      const updated = orm
        .update(users)
        // The admin chose this password and knows it, so the person picks their own on next sign-in.
        .set({ password: hash, must_change_password: 1 })
        .where(sql`${users.id} = ${id}`)
        .returning({ id: users.id })
        .get();
      if (!updated) throw notFound('user not found');
      // A reset after a suspected compromise must kill stolen cookies too, and an
      // event stream opened with one is as good as a cookie: close those as well.
      orm.delete(sessions).where(eq(sessions.user_id, updated.id)).run();
      ctx.events.closeForUser(updated.id);
    },

    /**
     * Admin only. Switches an account off: it cannot sign in, its sessions are deleted and its
     * event streams closed now. Its tickets, comments and history are untouched. Idempotent.
     * Refused for the admin's own account and for the last active admin; both checks and the
     * write are one transaction, so two admins cannot each deactivate the other.
     */
    deactivate(id: string, actor: SessionUser): DeactivationResult {
      const userId = parseId(id);
      const result = orm.transaction((tx) => {
        const target = tx
          .select({
            id: users.id,
            is_admin: users.is_admin,
            deactivated_at: users.deactivated_at,
          })
          .from(users)
          .where(eq(users.id, userId))
          .get();
        if (!target) throw notFound('user not found');
        if (target.id === actor.id) throw conflict('you cannot deactivate your own account');
        if (target.deactivated_at) return { id: target.id, deactivated_at: target.deactivated_at };
        if (target.is_admin && activeAdminsOtherThan(tx, target.id) === 0) {
          throw conflict('the last active admin cannot be deactivated');
        }
        const row = tx
          .update(users)
          .set({ deactivated_at: sql`datetime('now')` })
          .where(eq(users.id, target.id))
          .returning({ id: users.id, deactivated_at: users.deactivated_at })
          .get();
        tx.delete(sessions).where(eq(sessions.user_id, target.id)).run();
        return row;
      });
      ctx.events.closeForUser(result.id);
      return result;
    },

    /** Admin only. Switches an account back on. The person signs in with the password they had. Idempotent. */
    reactivate(id: string): DeactivationResult {
      const updated = orm
        .update(users)
        .set({ deactivated_at: null })
        .where(eq(users.id, parseId(id)))
        .returning({ id: users.id, deactivated_at: users.deactivated_at })
        .get();
      if (!updated) throw notFound('user not found');
      return updated;
    },
  };

  /** How many active admins there are besides one account. The rule "never zero" hangs on this. */
  function activeAdminsOtherThan(tx: Pick<typeof orm, 'select'>, userId: number): number {
    return (
      tx
        .select({ n: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.is_admin, 1), isNull(users.deactivated_at), ne(users.id, userId)))
        .get()?.n ?? 0
    );
  }
}
