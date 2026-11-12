import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE,
  DepartmentSchema,
  normalisePhaseEdit,
  openPhaseTicketsMessage,
  planPhaseMove,
} from './index.js';

const names = ['Product', 'Design', 'Engineering', 'QA', 'Release'];

describe('DEFAULT_PIPELINE', () => {
  it('is Product, Design, Engineering, QA, Release with no departments', () => {
    expect(DEFAULT_PIPELINE.map((p) => p.name)).toEqual(names);
    expect(DEFAULT_PIPELINE.every((p) => p.department === null)).toBe(true);
  });
});

describe('planPhaseMove', () => {
  it('approves to the next phase by default and to any later one when asked', () => {
    expect(planPhaseMove(names, 'Design', { decision: 'approve' })).toEqual({
      ok: true,
      decision: 'approve',
      to: 'Engineering',
      reason: null,
    });
    expect(
      planPhaseMove(names, 'Design', { decision: 'approve', to_phase: 'Release' }),
    ).toMatchObject({
      ok: true,
      to: 'Release',
    });
  });

  it('completes the feature when approving out of the last phase', () => {
    expect(planPhaseMove(names, 'Release', { decision: 'approve' })).toEqual({
      ok: true,
      decision: 'approve',
      to: null,
      reason: null,
    });
  });

  it('sends back to the previous phase by default, with a trimmed required reason', () => {
    expect(
      planPhaseMove(names, 'Engineering', { decision: 'reject', reason: '  unclear  ' }),
    ).toEqual({
      ok: true,
      decision: 'reject',
      to: 'Design',
      reason: 'unclear',
    });
    expect(
      planPhaseMove(names, 'Engineering', { decision: 'reject', to_phase: 'Product', reason: 'x' }),
    ).toMatchObject({ to: 'Product' });
    expect(planPhaseMove(names, 'Engineering', { decision: 'reject' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      planPhaseMove(names, 'Engineering', { decision: 'reject', reason: '   ' }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      planPhaseMove(names, 'Engineering', { decision: 'reject', reason: 'x'.repeat(1001) }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses the wrong direction, unknown phases and a missing earlier phase', () => {
    expect(planPhaseMove(names, 'QA', { decision: 'approve', to_phase: 'Design' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(planPhaseMove(names, 'QA', { decision: 'approve', to_phase: 'QA' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      planPhaseMove(names, 'QA', { decision: 'reject', to_phase: 'Release', reason: 'x' }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(planPhaseMove(names, 'QA', { decision: 'approve', to_phase: 'Nope' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(planPhaseMove(names, 'Product', { decision: 'reject', reason: 'x' })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(planPhaseMove(names, 'Gone', { decision: 'approve' })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(planPhaseMove(names, 'QA', { decision: 'maybe' })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe('normalisePhaseEdit', () => {
  const edit = (phases: Array<{ name: string; department?: string | null; was?: string | null }>) =>
    normalisePhaseEdit({ phases }, names, DepartmentSchema);

  it('keeps order, trims names, and defaults was to the name', () => {
    expect(edit([{ name: ' QA ' }, { name: 'Product', department: 'Product' }])).toEqual({
      ok: true,
      entries: [
        { name: 'QA', department: null, was: 'QA' },
        { name: 'Product', department: 'Product', was: 'Product' },
      ],
    });
  });

  it('tracks a rename by was, ignoring case, and refuses misuse', () => {
    expect(edit([{ name: 'Discovery', was: 'product' }])).toMatchObject({
      ok: true,
      entries: [{ name: 'Discovery', was: 'Product' }],
    });
    expect(edit([{ name: 'A', was: 'Ghost' }])).toMatchObject({ ok: false });
    expect(
      edit([
        { name: 'A', was: 'QA' },
        { name: 'B', was: 'QA' },
      ]),
    ).toMatchObject({ ok: false });
    expect(edit([{ name: 'A' }, { name: 'a' }])).toMatchObject({ ok: false });
    expect(edit([{ name: 'x\ny' }])).toMatchObject({ ok: false });
    expect(edit([{ name: 'ok', department: 'a‮b' }])).toMatchObject({ ok: false });
  });
});

describe('openPhaseTicketsMessage', () => {
  it('reads naturally for one and many', () => {
    expect(openPhaseTicketsMessage(1, 'QA')).toBe(
      '1 ticket in QA is still open: confirm to move on anyway',
    );
    expect(openPhaseTicketsMessage(3, 'QA')).toBe(
      '3 tickets in QA are still open: confirm to move on anyway',
    );
  });
});
