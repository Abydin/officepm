// The quick-add default type, checked against the boards the repo actually seeds.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultTicketType } from '@officepm/shared';

describe('defaultTicketType on the seeded boards', () => {
  it('is never an epic and is the board own first type unless that is an epic', () => {
    const file = path.resolve(import.meta.dirname, '../../../projects.json');
    const { projects } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      projects: Array<{ slug: string; boards: Array<{ slug: string; types: string[] }> }>;
    };
    const got = Object.fromEntries(
      projects.flatMap((p) =>
        p.boards.map((b) => [`${p.slug}/${b.slug}`, defaultTicketType(b.types)]),
      ),
    );
    expect(got).toEqual({
      'food/eng': 'task',
      'food/design': 'task',
      'food/support': 'ticket',
      'northwind/product': 'pitch',
      'northwind/marketing': 'post',
      'acme/eng': 'task',
      'acme/qa': 'test-case',
    });
  });
});
