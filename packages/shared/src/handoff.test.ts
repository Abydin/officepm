import { describe, expect, it } from 'vitest';
import {
  DepartmentSchema,
  HandoffNoticeListSchema,
  HandoffRequestSchema,
  HandoffResultSchema,
  PersonListSchema,
  SERVER_EVENTS,
  handoffOptions,
  planHandoff,
  transitionViolation,
} from './index.js';

const kanban = { flow: 'kanban', statuses: ['Backlog', 'Design', 'Review', 'Done'] } as const;
const waterfall = {
  flow: 'waterfall',
  statuses: ['Requirements', 'Design', 'Implementation', 'Verification'],
} as const;

describe('transitionViolation', () => {
  it('lets a kanban board move anywhere', () => {
    expect(transitionViolation(kanban, 'Backlog', 'Done')).toBeNull();
  });
  it('refuses a waterfall board skipping ahead, and allows one step and any move back', () => {
    expect(transitionViolation(waterfall, 'Requirements', 'Implementation')).toMatch(
      /sequential only/,
    );
    expect(transitionViolation(waterfall, 'Requirements', 'Design')).toBeNull();
    expect(transitionViolation(waterfall, 'Verification', 'Requirements')).toBeNull();
  });
  it('treats a move to the same status as no violation', () => {
    expect(transitionViolation(waterfall, 'Design', 'Design')).toBeNull();
  });
});

describe('handoffOptions', () => {
  it('offers the next and previous status and everything forward and back', () => {
    expect(handoffOptions(kanban, 'Design')).toEqual({
      next: 'Review',
      previous: 'Backlog',
      forward: ['Review', 'Done'],
      back: ['Backlog'],
    });
  });
  it('has no next on the last status and no previous on the first', () => {
    expect(handoffOptions(kanban, 'Done').next).toBeNull();
    expect(handoffOptions(kanban, 'Backlog').previous).toBeNull();
  });
  it('only offers the next phase forward on a waterfall board', () => {
    expect(handoffOptions(waterfall, 'Requirements').forward).toEqual(['Design']);
    expect(handoffOptions(waterfall, 'Implementation').back).toEqual(['Requirements', 'Design']);
  });
  it('offers nothing for a status the board does not have', () => {
    expect(handoffOptions(kanban, 'Gone')).toEqual({
      next: null,
      previous: null,
      forward: [],
      back: [],
    });
  });
});

describe('planHandoff', () => {
  it('approve defaults to the next status', () => {
    expect(planHandoff(kanban, 'Design', { decision: 'approve' })).toEqual({
      ok: true,
      decision: 'approve',
      to: 'Review',
      reason: null,
    });
  });
  it('approve may pick any later status the workflow allows', () => {
    expect(
      planHandoff(kanban, 'Backlog', { decision: 'approve', to_status: 'Done' }),
    ).toMatchObject({ ok: true, to: 'Done' });
  });
  it('approve may not go backwards or stay put', () => {
    expect(planHandoff(kanban, 'Review', { decision: 'approve', to_status: 'Design' })).toEqual({
      ok: false,
      status: 400,
      message: 'approve must move to a later status',
    });
    expect(
      planHandoff(kanban, 'Review', { decision: 'approve', to_status: 'Review' }),
    ).toMatchObject({ ok: false, status: 400 });
  });
  it('approve from the last status has nowhere to go', () => {
    expect(planHandoff(kanban, 'Done', { decision: 'approve' })).toEqual({
      ok: false,
      status: 409,
      message: 'there is no later status after "Done"',
    });
  });
  it('applies the waterfall no-skipping rule', () => {
    const plan = planHandoff(waterfall, 'Requirements', {
      decision: 'approve',
      to_status: 'Implementation',
    });
    expect(plan).toMatchObject({ ok: false, status: 409 });
    expect(plan.ok === false && plan.message).toMatch(/sequential only/);
  });
  it('reject needs a reason and defaults to the previous status', () => {
    expect(planHandoff(kanban, 'Review', { decision: 'reject' })).toEqual({
      ok: false,
      status: 400,
      message: 'a reason is required when sending a ticket back',
    });
    expect(planHandoff(kanban, 'Review', { decision: 'reject', reason: '   ' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(planHandoff(kanban, 'Review', { decision: 'reject', reason: ' Wrong icon ' })).toEqual({
      ok: true,
      decision: 'reject',
      to: 'Design',
      reason: 'Wrong icon',
    });
  });
  it('reject may pick any earlier status but not a later one', () => {
    expect(
      planHandoff(kanban, 'Done', { decision: 'reject', reason: 'x', to_status: 'Backlog' }),
    ).toMatchObject({ ok: true, to: 'Backlog' });
    expect(
      planHandoff(kanban, 'Design', { decision: 'reject', reason: 'x', to_status: 'Done' }),
    ).toEqual({ ok: false, status: 400, message: 'reject must move to an earlier status' });
  });
  it('reject from the first status has nowhere to go', () => {
    expect(planHandoff(kanban, 'Backlog', { decision: 'reject', reason: 'x' })).toMatchObject({
      ok: false,
      status: 409,
    });
  });
  it('rejects an unknown decision, an unknown target and a reason that is too long', () => {
    expect(planHandoff(kanban, 'Design', { decision: 'maybe' })).toEqual({
      ok: false,
      status: 400,
      message: 'decision must be approve or reject',
    });
    expect(planHandoff(kanban, 'Design', { decision: 'approve', to_status: 'Nope' })).toEqual({
      ok: false,
      status: 400,
      message: 'to_status must be one of: Backlog, Design, Review, Done',
    });
    expect(
      planHandoff(kanban, 'Review', { decision: 'reject', reason: 'x'.repeat(1001) }),
    ).toMatchObject({ ok: false, status: 400 });
  });
  it('refuses a ticket whose status is not on the board', () => {
    expect(planHandoff(kanban, 'Gone', { decision: 'approve' })).toMatchObject({
      ok: false,
      status: 409,
    });
  });
});

describe('handoff wire shapes', () => {
  it('accepts a minimal and a full request, and rejects wrong types', () => {
    expect(HandoffRequestSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(
      HandoffRequestSchema.safeParse({
        decision: 'reject',
        to_status: 'Backlog',
        from_status: 'Review',
        reason: 'no',
        assignee_id: 7,
        department: 'Design',
        note: 'hi',
        attachment_ids: ['x'],
      }).success,
    ).toBe(true);
    expect(HandoffRequestSchema.safeParse({ decision: 'approve', note: 4 }).success).toBe(false);
    expect(
      HandoffRequestSchema.safeParse({ decision: 'approve', attachment_ids: 'x' }).success,
    ).toBe(false);
  });
  it('limits a department to a short single line', () => {
    expect(DepartmentSchema.parse('  Design ')).toBe('Design');
    expect(DepartmentSchema.safeParse('').success).toBe(false);
    expect(DepartmentSchema.safeParse('x'.repeat(41)).success).toBe(false);
    expect(DepartmentSchema.safeParse('a\nb').success).toBe(false);
  });
  it('describes people, notices and the result', () => {
    PersonListSchema.parse([{ id: 1, name: 'A', department: null }]);
    HandoffNoticeListSchema.parse([
      {
        id: 'h1',
        ticket_key: 'FOOD-DES-1',
        ticket_title: 'Logo',
        decision: 'approve',
        from_status: 'Design',
        to_status: 'Review',
        from_name: 'Maya',
        note: null,
        reason: null,
        created_at: '2026-11-11 10:00:00',
      },
    ]);
    expect(HandoffResultSchema.shape.handoff.shape.id).toBeDefined();
  });
  it('announces handoffs on the event stream', () => {
    expect(SERVER_EVENTS).toContain('handoff.created');
  });
});
