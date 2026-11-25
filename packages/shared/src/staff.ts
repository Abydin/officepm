// Staff accounts: invite links, choosing a password, deactivating people and the CSV import.
// The server and the web client both read these, so the rules (what an email is, how long a
// new password must be, how many rows an import takes) are written once.
import { z } from 'zod';
import { SINGLE_LINE } from './entities.js';

/** The error text of the 403 the server gives a signed-in person who has to change their password first. */
export const PASSWORD_CHANGE_REQUIRED = 'password_change_required';

/** A new password chosen by the person themselves (invite accept, self change). */
export const NEW_PASSWORD_MIN = 8;
/** bcrypt only reads the first 72 bytes, so a longer password would be silently cut short. */
export const NEW_PASSWORD_MAX_BYTES = 72;

/** Length in UTF-8 bytes, which is what bcrypt counts. */
function utf8Length(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export const NewPasswordSchema = z
  .string()
  .min(NEW_PASSWORD_MIN, `must be at least ${NEW_PASSWORD_MIN} characters`)
  .refine(
    (value) => utf8Length(value) <= NEW_PASSWORD_MAX_BYTES,
    `must be at most ${NEW_PASSWORD_MAX_BYTES} bytes`,
  )
  // bcrypt stops reading at a NUL, so a password of NULs hashes like the empty string.
  .refine((value) => !value.includes('\u0000'), 'must not contain a NUL character')
  .refine((value) => value.trim() !== '', 'must not be only spaces');

/** POST /api/me/password. */
export const PasswordChangeSchema = z.object({
  current_password: z.string().min(1, 'is required'),
  new_password: NewPasswordSchema,
});
export type PasswordChange = z.infer<typeof PasswordChangeSchema>;

export const MAX_EMAIL_LENGTH = 254;
export const MAX_STAFF_NAME_LENGTH = 100;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const StaffEmailSchema = z
  .string()
  .trim()
  .max(MAX_EMAIL_LENGTH, `must be at most ${MAX_EMAIL_LENGTH} characters`)
  .regex(EMAIL_PATTERN, 'must be an email address');
export const StaffNameSchema = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(MAX_STAFF_NAME_LENGTH, `must be at most ${MAX_STAFF_NAME_LENGTH} characters`)
  .regex(SINGLE_LINE, 'must be a single line');

/** How long an invite link works. */
export const INVITE_DAYS = 7;

/** POST /api/invites. */
export const InviteCreateSchema = z.object({
  email: StaffEmailSchema,
  name: StaffNameSchema,
  is_admin: z.boolean().optional(),
});
export type InviteCreate = z.infer<typeof InviteCreateSchema>;

/** POST /api/invites response. The link holds the only copy of the token, so it is shown once. */
export const InviteCreatedSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  is_admin: z.boolean(),
  expires_at: z.string(),
  link: z.string(),
});
export type InviteCreated = z.infer<typeof InviteCreatedSchema>;

export const INVITE_STATUSES = ['pending', 'used', 'expired'] as const;
export const InviteStatusSchema = z.enum(INVITE_STATUSES);
export type InviteStatus = z.infer<typeof InviteStatusSchema>;

/** GET /api/invites (admin only). Never carries a token or its hash. */
export const InviteListItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  is_admin: z.boolean(),
  status: InviteStatusSchema,
  created_by: z.number().int().nullable(),
  created_by_name: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
  used_at: z.string().nullable(),
});
export type InviteListItem = z.infer<typeof InviteListItemSchema>;
export const InviteListSchema = z.array(InviteListItemSchema);

/** GET /api/invites/:token (public). Only what the accept screen shows. */
export const InvitePreviewSchema = z.object({ email: z.string(), name: z.string() });
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

/** POST /api/invites/:token/accept (public). */
export const InviteAcceptSchema = z.object({ password: NewPasswordSchema });
export type InviteAccept = z.infer<typeof InviteAcceptSchema>;

/** POST /api/users/:id/deactivate and /reactivate. */
export const DeactivationResultSchema = z.object({
  id: z.number().int(),
  deactivated_at: z.string().nullable(),
});
export type DeactivationResult = z.infer<typeof DeactivationResultSchema>;

/** The CSV import takes at most this many people at once, and this much text. */
export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_CSV_CHARS = 128 * 1024;

/**
 * POST /api/invites/import. `dry_run` defaults to true on the server: only an explicit
 * `false` creates invites.
 */
export const ImportRequestSchema = z.object({
  csv: z.string(),
  dry_run: z.boolean().optional(),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export const ImportRowSchema = z.object({
  /** 1 for the first row under the header. */
  row: z.number().int(),
  email: z.string(),
  name: z.string(),
  is_admin: z.boolean(),
  status: z.enum(['ok', 'error']),
  error: z.string().nullable(),
  /** Set only on a real run, for a row that got an invite. */
  invite_link: z.string().nullable(),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export const ImportResultSchema = z.object({
  dry_run: z.boolean(),
  total: z.number().int(),
  /** Rows that passed every check. */
  valid: z.number().int(),
  /** Invites made: 0 on a dry run. */
  created: z.number().int(),
  failed: z.number().int(),
  rows: z.array(ImportRowSchema),
  /** `email,name,invite_link` for the created rows, spreadsheet-safe. Null on a dry run. */
  csv: z.string().nullable(),
});
export type ImportResult = z.infer<typeof ImportResultSchema>;
