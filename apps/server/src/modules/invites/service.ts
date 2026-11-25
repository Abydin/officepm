import crypto from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  ImportRequestSchema,
  InviteAcceptSchema,
  InviteCreateSchema,
  INVITE_DAYS,
  MAX_IMPORT_CSV_CHARS,
  MAX_IMPORT_ROWS,
  StaffEmailSchema,
  StaffNameSchema,
  firstRequestIssue,
  type ImportResult,
  type ImportRow,
  type InviteCreated,
  type InviteListItem,
  type InvitePreview,
  type User,
} from '@officepm/shared';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { schema } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../http/errors.js';
import { LoginThrottle } from '../../http/throttle.js';
import { requireShape } from '../../http/validate.js';
import { csvLine, CsvError, parseCsv } from '../../lib/csv.js';
import {
  BCRYPT_ROUNDS,
  issueSession,
  TooManyAttempts,
  type SessionIssue,
} from '../auth/service.js';
import bcrypt from 'bcrypt';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** What every bad token gets, so the answer says nothing about why it failed. */
const gone = () => notFound('invite not found');

export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const normalEmail = (email: string) => email.trim().toLowerCase();

export interface AcceptResult extends SessionIssue {
  user: User;
}

export function createInviteService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { users, invites } = schema;
  const throttle = ctx.inviteThrottle ?? new LoginThrottle();

  /** A live invite: not used and not past its expiry. Both sides of the date go through datetime(). */
  const live = and(isNull(invites.used_at), sql`datetime(${invites.expires_at}) > datetime('now')`);

  const accountExists = (tx: Pick<typeof orm, 'select'>, email: string) =>
    !!tx.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  const pendingInvite = (tx: Pick<typeof orm, 'select'>, email: string) =>
    !!tx
      .select({ id: invites.id })
      .from(invites)
      .where(and(eq(invites.email, email), live))
      .get();

  /** Makes one invite row and returns the one-time token. Callers have checked the email. */
  function insertInvite(
    tx: Pick<typeof orm, 'insert' | 'select'>,
    who: { email: string; name: string; isAdmin: boolean },
    actor: SessionUser,
  ): { id: string; token: string; expires_at: string } {
    const token = crypto.randomBytes(32).toString('base64url');
    const row = tx
      .insert(invites)
      .values({
        id: crypto.randomUUID(),
        token_hash: hashToken(token),
        email: who.email,
        name: who.name,
        is_admin: who.isAdmin ? 1 : 0,
        created_by: actor.id,
        expires_at: sql`datetime('now', ${`+${INVITE_DAYS} days`})`,
      })
      .returning({ id: invites.id, expires_at: invites.expires_at })
      .get();
    return { id: row.id, token, expires_at: row.expires_at };
  }

  const linkFor = (origin: string, token: string) => `${origin}/#/invite/${token}`;

  /** The invite a token opens, or the uniform 404. The hashes are compared in constant time. */
  function findLive(token: string) {
    if (!TOKEN_SHAPE.test(token)) throw gone();
    const hash = hashToken(token);
    const row = orm
      .select()
      .from(invites)
      .where(and(eq(invites.token_hash, hash), live))
      .get();
    if (!row) throw gone();
    const a = Buffer.from(row.token_hash, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw gone();
    return row;
  }

  /** Counts a guess, answers 429 when the address has used its share. Refund with attempt.success(). */
  function guard(ip: string) {
    const attempt = throttle.begin(ip, 'invite', false);
    if (attempt.wait > 0) throw new TooManyAttempts(attempt.wait);
    return attempt;
  }

  return {
    create(b: JsonBody, actor: SessionUser, origin: string): InviteCreated {
      requireShape(InviteCreateSchema, b);
      const email = normalEmail(b.email as string);
      const name = (b.name as string).trim();
      const isAdmin = b.is_admin === true;
      return orm.transaction((tx) => {
        if (accountExists(tx, email)) throw conflict('a user with that email already exists');
        if (pendingInvite(tx, email)) {
          throw conflict('an invite for that email is already pending, revoke it first');
        }
        const made = insertInvite(tx, { email, name, isAdmin }, actor);
        return {
          id: made.id,
          email,
          name,
          is_admin: isAdmin,
          expires_at: made.expires_at,
          link: linkFor(origin, made.token),
        };
      });
    },

    list(): InviteListItem[] {
      const creator = orm.select({ id: users.id, name: users.name }).from(users).as('creator');
      return orm
        .select({
          id: invites.id,
          email: invites.email,
          name: invites.name,
          is_admin: invites.is_admin,
          status: sql<InviteListItem['status']>`CASE
            WHEN ${invites.used_at} IS NOT NULL THEN 'used'
            WHEN datetime(${invites.expires_at}) <= datetime('now') THEN 'expired'
            ELSE 'pending' END`,
          created_by: invites.created_by,
          created_by_name: creator.name,
          created_at: invites.created_at,
          expires_at: invites.expires_at,
          used_at: invites.used_at,
        })
        .from(invites)
        .leftJoin(creator, eq(creator.id, invites.created_by))
        .orderBy(desc(sql`${invites}.rowid`))
        .all()
        .map((r) => ({ ...r, is_admin: !!r.is_admin })) as InviteListItem[];
    },

    /** Deletes an invite that has not been used, pending or expired. A used one is a record of an account. */
    revoke(id: string): void {
      const row = orm
        .select({ used_at: invites.used_at })
        .from(invites)
        .where(eq(invites.id, id))
        .get();
      if (!row) throw notFound('invite not found');
      if (row.used_at) throw conflict('an invite that was accepted cannot be revoked');
      orm
        .delete(invites)
        .where(and(eq(invites.id, id), isNull(invites.used_at)))
        .run();
    },

    /** Public. Only the email and name the accept screen shows. */
    preview(token: string, ip: string): InvitePreview {
      const attempt = guard(ip);
      const row = findLive(token);
      attempt.success();
      return { email: row.email, name: row.name };
    },

    /**
     * Public. Creates the account and signs it in. The invite is claimed with a conditional
     * UPDATE inside the same transaction that inserts the user and the session, so two
     * requests with one token make one account, and an email that already has an account
     * rolls the claim back and leaves the invite untouched.
     */
    async accept(token: string, b: JsonBody, ip: string): Promise<AcceptResult> {
      const attempt = guard(ip);
      findLive(token);
      // Possession of a real token is the proof: a bad password below is not a guess at it.
      attempt.success();
      const issue = firstRequestIssue(InviteAcceptSchema, b);
      if (issue) throw badRequest(issue);
      // bcrypt is async and a transaction is synchronous, so the hash is made first.
      const hash = await bcrypt.hash(b.password as string, BCRYPT_ROUNDS);
      const hashOfToken = hashToken(token);
      return orm.transaction((tx) => {
        const claimed = tx
          .update(invites)
          .set({ used_at: sql`datetime('now')` })
          .where(and(eq(invites.token_hash, hashOfToken), live))
          .returning({ email: invites.email, name: invites.name, is_admin: invites.is_admin })
          .get();
        if (!claimed) throw gone();
        if (accountExists(tx, claimed.email)) {
          throw conflict('an account with that email already exists');
        }
        const created = tx
          .insert(users)
          .values({
            email: claimed.email,
            name: claimed.name,
            password: hash,
            is_admin: claimed.is_admin ? 1 : 0,
            // They chose this password themselves.
            must_change_password: 0,
          })
          .returning({ id: users.id })
          .get();
        const session = issueSession(tx, created.id);
        return {
          ...session,
          user: {
            id: created.id,
            email: claimed.email,
            name: claimed.name,
            isAdmin: !!claimed.is_admin,
            mustChangePassword: false,
          },
        };
      });
    },

    /**
     * Admin only. Validates a pasted CSV (email,name,is_admin) and, unless dry_run is true or
     * absent, makes one invite per valid row. Rows that fail are reported and skipped. Every
     * check runs again on the real run, inside its transaction, so a preview cannot go stale.
     */
    importStaff(b: JsonBody, actor: SessionUser, origin: string): ImportResult {
      requireShape(ImportRequestSchema, b);
      const csv = b.csv as string;
      if (csv.length > MAX_IMPORT_CSV_CHARS) {
        throw new HttpError(413, `csv is too large, ${MAX_IMPORT_CSV_CHARS / 1024} KB at most`);
      }
      const dryRun = b.dry_run !== false;
      const parsed = parseRows(csv);
      return orm.transaction((tx) => {
        const seen = new Set<string>();
        const rows: ImportRow[] = [];
        const lines: string[] = [];
        for (const r of parsed) {
          const error = r.error ?? rowProblem(tx, r, seen);
          const row: ImportRow = {
            row: r.row,
            email: r.email,
            name: r.name,
            is_admin: r.isAdmin,
            status: error ? 'error' : 'ok',
            error: error ?? null,
            invite_link: null,
          };
          if (!error && !dryRun) {
            const made = insertInvite(
              tx,
              { email: normalEmail(r.email), name: r.name.trim(), isAdmin: r.isAdmin },
              actor,
            );
            row.invite_link = linkFor(origin, made.token);
            lines.push(csvLine([normalEmail(r.email), r.name.trim(), row.invite_link]));
          }
          rows.push(row);
        }
        const valid = rows.filter((r) => r.status === 'ok').length;
        return {
          dry_run: dryRun,
          total: rows.length,
          valid,
          created: dryRun ? 0 : valid,
          failed: rows.length - valid,
          rows,
          csv: dryRun
            ? null
            : [csvLine(['email', 'name', 'invite_link']), ...lines].join('\r\n') + '\r\n',
        };
      });

      function rowProblem(
        tx: Pick<typeof orm, 'select'>,
        r: ParsedRow,
        seen: Set<string>,
      ): string | null {
        const emailIssue = firstRequestIssue(StaffEmailSchema, r.email);
        if (emailIssue) return 'email ' + emailIssue;
        const nameIssue = firstRequestIssue(StaffNameSchema, r.name);
        if (nameIssue) return 'name ' + nameIssue;
        const email = normalEmail(r.email);
        if (seen.has(email)) return 'email appears more than once in this file';
        seen.add(email);
        if (accountExists(tx, email)) return 'that email already has an account';
        if (pendingInvite(tx, email)) return 'that email already has a pending invite';
        return null;
      }
    },
  };
}

export type InviteService = ReturnType<typeof createInviteService>;

interface ParsedRow {
  row: number;
  email: string;
  name: string;
  isAdmin: boolean;
  /** A problem found while reading the row, before any account lookups. */
  error?: string;
}

const TRUE = new Set(['true', '1', 'yes', 'y']);
const FALSE = new Set(['', 'false', '0', 'no', 'n']);

/** Reads the CSV into rows. A problem with the file as a whole is a 400; one with a row stays on the row. */
function parseRows(csv: string): ParsedRow[] {
  let records: string[][];
  try {
    records = parseCsv(csv);
  } catch (e) {
    if (e instanceof CsvError) throw badRequest('csv: ' + e.message);
    throw e;
  }
  const header = records.shift();
  if (!header) throw badRequest('csv is empty: expected a header row of email,name,is_admin');
  const names = header.map((h) => h.trim().toLowerCase());
  const known = ['email', 'name', 'is_admin'];
  const unknown = names.find((n) => !known.includes(n));
  if (unknown !== undefined) {
    throw badRequest(`csv: unknown column "${unknown.slice(0, 40)}", expected email,name,is_admin`);
  }
  if (new Set(names).size !== names.length) throw badRequest('csv: a column appears twice');
  const col = (n: string) => names.indexOf(n);
  if (col('email') < 0 || col('name') < 0) throw badRequest('csv: the header needs email and name');
  if (records.length === 0) throw badRequest('csv has no rows under the header');
  if (records.length > MAX_IMPORT_ROWS) {
    throw badRequest(`csv has ${records.length} rows, ${MAX_IMPORT_ROWS} at most per import`);
  }
  return records.map((cells, i): ParsedRow => {
    const base = {
      row: i + 1,
      email: (cells[col('email')] ?? '').trim(),
      name: (cells[col('name')] ?? '').trim(),
      isAdmin: false,
    };
    if (cells.length !== names.length) {
      return { ...base, error: `expected ${names.length} columns, found ${cells.length}` };
    }
    const flag = (cells[col('is_admin')] ?? '').trim().toLowerCase();
    if (!TRUE.has(flag) && !FALSE.has(flag)) {
      return { ...base, error: 'is_admin must be true, false, yes, no, 1 or 0' };
    }
    return { ...base, isAdmin: TRUE.has(flag) };
  });
}
