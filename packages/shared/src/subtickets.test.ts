import { describe, expect, it } from 'vitest';
import {
  openSubticketsMessage,
  SubticketCreateSchema,
  SubticketOfSchema,
  subticketViolation,
  type SubticketNode,
} from './index.js';

const node = (over: Partial<SubticketNode> = {}): SubticketNode => ({
  key: 'A-1',
  type: 'task',
  project_slug: 'food',
  subticket_of: null,
  has_subtickets: false,
  ...over,
});

describe('subticketViolation', () => {
  it('allows an ordinary ticket under an ordinary ticket of the same project', () => {
    expect(subticketViolation(node({ key: 'A-2' }), node())).toBeNull();
  });

  it('refuses a ticket as its own parent', () => {
    expect(subticketViolation(node(), node())).toMatch(/own parent/);
  });

  it('refuses an epic as a sub-ticket, and an epic as a parent', () => {
    expect(subticketViolation(node({ key: 'A-2', type: 'epic' }), node())).toMatch(/epic/);
    expect(subticketViolation(node({ key: 'A-2' }), node({ type: 'epic' }))).toMatch(/epic/);
  });

  it('allows one level only: no sub-ticket under a sub-ticket', () => {
    const msg = subticketViolation(node({ key: 'A-3' }), node({ key: 'A-2', subticket_of: 'A-1' }));
    expect(msg).toMatch(/one level/);
    expect(msg).toContain('A-2');
  });

  it('refuses to make a ticket that has sub-tickets a sub-ticket itself', () => {
    expect(
      subticketViolation(node({ key: 'A-2', has_subtickets: true }), node({ key: 'A-1' })),
    ).toMatch(/one level/);
  });

  it('keeps parent and child in one project', () => {
    expect(subticketViolation(node({ key: 'A-2', project_slug: 'acme' }), node())).toMatch(
      /same project/,
    );
  });

  it('reports the first rule that applies, so a self-parent is not called a depth problem', () => {
    expect(
      subticketViolation(
        node({ subticket_of: 'X-1', has_subtickets: true }),
        node({ subticket_of: 'X-1' }),
      ),
    ).toMatch(/own parent/);
  });
});

describe('openSubticketsMessage', () => {
  it('uses the singular and the plural', () => {
    expect(openSubticketsMessage(1)).toMatch(/^1 sub-ticket is still open/);
    expect(openSubticketsMessage(3)).toMatch(/^3 sub-tickets are still open/);
  });
});

describe('request schemas', () => {
  it('needs a non-blank title to create a sub-ticket', () => {
    expect(SubticketCreateSchema.safeParse({ title: 'x' }).success).toBe(true);
    expect(SubticketCreateSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(SubticketCreateSchema.safeParse({}).success).toBe(false);
  });

  it('takes a key or null to attach, and nothing else', () => {
    expect(SubticketOfSchema.safeParse({ parent_key: 'A-1' }).success).toBe(true);
    expect(SubticketOfSchema.safeParse({ parent_key: null }).success).toBe(true);
    expect(SubticketOfSchema.safeParse({ parent_key: '' }).success).toBe(false);
    expect(SubticketOfSchema.safeParse({}).success).toBe(false);
  });
});
