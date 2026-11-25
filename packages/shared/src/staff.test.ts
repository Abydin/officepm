import { describe, expect, it } from 'vitest';
import {
  ImportResultSchema,
  InviteCreateSchema,
  InviteListItemSchema,
  NEW_PASSWORD_MAX_BYTES,
  NEW_PASSWORD_MIN,
  NewPasswordSchema,
  PasswordChangeSchema,
  PasswordResetSchema,
  UserListItemSchema,
  UserSchema,
  firstRequestIssue,
} from './index.js';

describe('new passwords', () => {
  it('need 8 characters while an admin reset keeps its minimum of 6', () => {
    expect(NEW_PASSWORD_MIN).toBe(8);
    expect(NewPasswordSchema.safeParse('1234567').success).toBe(false);
    expect(NewPasswordSchema.safeParse('12345678').success).toBe(true);
    expect(PasswordResetSchema.safeParse({ password: '123456' }).success).toBe(true);
  });

  it('stop at the 72 bytes bcrypt reads, counting bytes and not characters', () => {
    expect(NewPasswordSchema.safeParse('a'.repeat(NEW_PASSWORD_MAX_BYTES)).success).toBe(true);
    expect(NewPasswordSchema.safeParse('a'.repeat(NEW_PASSWORD_MAX_BYTES + 1)).success).toBe(false);
    // 25 three-byte characters are 75 bytes.
    expect(NewPasswordSchema.safeParse('€'.repeat(25)).success).toBe(false);
  });

  it('names the field in the first issue of a password change', () => {
    expect(
      firstRequestIssue(PasswordChangeSchema, { current_password: 'x', new_password: 'short' }),
    ).toBe('invalid new_password: must be at least 8 characters');
    expect(firstRequestIssue(PasswordChangeSchema, { new_password: 'long enough' })).toMatch(
      /^invalid current_password/,
    );
  });
});

describe('invites', () => {
  it('trims an email and a name and refuses a bad email or a multi-line name', () => {
    const ok = InviteCreateSchema.parse({ email: ' a@b.co ', name: ' Ada ' });
    expect(ok).toEqual({ email: 'a@b.co', name: 'Ada' });
    expect(InviteCreateSchema.safeParse({ email: 'nope', name: 'A' }).success).toBe(false);
    expect(InviteCreateSchema.safeParse({ email: 'a@b.co', name: 'A\nB' }).success).toBe(false);
    expect(InviteCreateSchema.safeParse({ email: 'a@b.co', name: '   ' }).success).toBe(false);
  });

  it('has a list row with no token field at all', () => {
    const row = InviteListItemSchema.parse({
      id: 'i',
      email: 'a@b.co',
      name: 'A',
      is_admin: false,
      status: 'pending',
      created_by: 1,
      created_by_name: 'Admin',
      created_at: '2026-01-01 00:00:00',
      expires_at: '2026-01-08 00:00:00',
      used_at: null,
      token: 'leak',
      token_hash: 'leak',
    });
    expect(Object.keys(row)).not.toContain('token');
    expect(Object.keys(row)).not.toContain('token_hash');
  });

  it('parses an import result', () => {
    expect(
      ImportResultSchema.safeParse({
        dry_run: true,
        total: 0,
        valid: 0,
        created: 0,
        failed: 0,
        rows: [],
        csv: null,
      }).success,
    ).toBe(true);
  });
});

describe('the user shapes', () => {
  it('accept a v1 answer that has none of the new fields', () => {
    expect(UserSchema.safeParse({ id: 1, email: 'a@b.c', name: 'A', isAdmin: true }).success).toBe(
      true,
    );
    expect(
      UserListItemSchema.safeParse({
        id: 1,
        email: 'a@b.c',
        name: 'A',
        is_admin: 1,
        created_at: '2026-01-01 00:00:00',
      }).success,
    ).toBe(true);
  });
});
