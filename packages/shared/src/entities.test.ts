import { describe, expect, it } from 'vitest';
import {
  ErrorBodySchema,
  TicketCreateSchema,
  TicketPatchSchema,
  TicketSchema,
  UserSchema,
} from './index.js';

const ticket = {
  id: 1,
  project_slug: 'food',
  board_slug: 'eng',
  key: 'FOOD-ENG-1',
  title: 'A ticket',
  type: 'task',
  status: 'Backlog',
  assignee: null,
  qa_owner: null,
  parent_key: null,
  level: null,
  description: null,
  acceptance_criteria: [],
  points: null,
  appetite: null,
  sprint_id: null,
  blocked: false,
  blocker_reason: null,
  priority: null,
  labels: [],
  due_date: null,
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00',
};

describe('entities', () => {
  it('accepts the API ticket shape and rejects the raw database shape', () => {
    expect(TicketSchema.safeParse(ticket).success).toBe(true);
    // As stored: labels is JSON text and blocked is 0/1. The API never sends this.
    expect(TicketSchema.safeParse({ ...ticket, labels: '["a"]', blocked: 0 }).success).toBe(false);
  });

  it('uses camelCase isAdmin on the session user', () => {
    expect(UserSchema.safeParse({ id: 1, email: 'a@b.c', name: 'A', isAdmin: true }).success).toBe(
      true,
    );
    expect(UserSchema.safeParse({ id: 1, email: 'a@b.c', name: 'A', is_admin: 1 }).success).toBe(
      false,
    );
  });

  it('mirrors the v1 extras validation on create and patch', () => {
    const base = { project_slug: 'food', board_slug: 'eng', title: 't', type: 'task' };
    expect(TicketCreateSchema.safeParse({ ...base, priority: 'urgent' }).success).toBe(true);
    expect(TicketCreateSchema.safeParse({ ...base, priority: 'asap' }).success).toBe(false);
    expect(TicketCreateSchema.safeParse({ ...base, due_date: '2026-13-1' }).success).toBe(false);
    expect(TicketCreateSchema.safeParse({ ...base, due_date: '2026-13-01' }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => 'l' + i);
    expect(TicketCreateSchema.safeParse({ ...base, labels: nine }).success).toBe(false);
    expect(TicketCreateSchema.safeParse({ ...base, labels: ['x'.repeat(25)] }).success).toBe(false);
    expect(TicketPatchSchema.safeParse({}).success).toBe(true);
    expect(TicketPatchSchema.safeParse({ status: 'Done', blocked: true }).success).toBe(true);
  });

  it('has the { error } shape', () => {
    expect(ErrorBodySchema.safeParse({ error: 'not found' }).success).toBe(true);
    expect(ErrorBodySchema.safeParse({ message: 'nope' }).success).toBe(false);
  });
});
