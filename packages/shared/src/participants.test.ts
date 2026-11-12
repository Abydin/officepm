import { describe, expect, it } from 'vitest';
import {
  HandoffRequestSchema,
  ParticipantAddSchema,
  ParticipantRoleSchema,
  ParticipantSchema,
  SERVER_EVENTS,
} from './index.js';

describe('ParticipantRoleSchema', () => {
  it('trims and accepts one plain line up to 30 characters', () => {
    expect(ParticipantRoleSchema.parse('  Frontend ')).toBe('Frontend');
    expect(ParticipantRoleSchema.safeParse('y'.repeat(30)).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['31 characters', 'y'.repeat(31)],
    ['a newline', 'a\nb'],
    ['a tab', 'a\tb'],
    ['a line separator', 'a b'],
    ['a zero-width space', 'a​b'],
    ['a right-to-left override', 'a‮b'],
    ['a bidi isolate', 'a⁦b'],
    ['a DEL', 'a\u007fb'],
  ])('rejects %s', (_name, value) => {
    expect(ParticipantRoleSchema.safeParse(value).success).toBe(false);
  });
});

describe('participant shapes', () => {
  it('accepts a missing or null role when adding, and requires an integer user id', () => {
    expect(ParticipantAddSchema.safeParse({ user_id: 3 }).success).toBe(true);
    expect(ParticipantAddSchema.safeParse({ user_id: 3, role: null }).success).toBe(true);
    expect(ParticipantAddSchema.safeParse({ user_id: '3' }).success).toBe(false);
    expect(ParticipantAddSchema.safeParse({ user_id: 3.5 }).success).toBe(false);
  });

  it('has no email field: an extra email is stripped from a parsed participant', () => {
    const parsed = ParticipantSchema.parse({
      id: 1,
      name: 'A',
      department: null,
      role: null,
      email: 'a@b.c',
    });
    expect(Object.keys(parsed).sort()).toEqual(['department', 'id', 'name', 'role']);
  });

  it('caps handoff participants at 20 and lists the participants event', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    expect(
      HandoffRequestSchema.safeParse({ decision: 'approve', participant_ids: ids(20) }).success,
    ).toBe(true);
    expect(
      HandoffRequestSchema.safeParse({ decision: 'approve', participant_ids: ids(21) }).success,
    ).toBe(false);
    expect(SERVER_EVENTS).toContain('ticket.participants.changed');
  });
});
