import { describe, expect, it } from 'vitest';
import { parseProjectsConfig, ProjectsConfigError, ProjectsRegistry } from './projects-config.js';

const board = (over: Record<string, unknown> = {}) => ({
  slug: 'eng',
  name: 'Engineering',
  prefix: 'AAA-ENG',
  flow: 'kanban',
  statuses: ['Backlog', 'Done'],
  types: ['task'],
  ...over,
});
const project = (over: Record<string, unknown> = {}) => ({
  slug: 'alpha',
  name: 'Alpha',
  boards: [board()],
  ...over,
});
const parse = (config: unknown) => parseProjectsConfig(JSON.stringify(config));

describe('parseProjectsConfig', () => {
  it('fills in defaults the way v1 did', () => {
    const b = parse({ projects: [project()] }).projects[0]!.boards[0]!;
    expect(b).toMatchObject({
      has_github: false,
      agile: false,
      points: false,
      wip_limits: {},
      done_statuses: ['Done'],
    });
  });

  it('refuses with v1 wording', () => {
    expect(() => parseProjectsConfig('{ nope')).toThrow(/not valid JSON/);
    expect(() => parse({})).toThrow('projects.json must have a top-level "projects" array');
    expect(() => parse({ projects: [project({ boards: [] })] })).toThrow(/at least one board/);
    expect(() => parse({ projects: [project({ slug: 'Alpha' })] })).toThrow(/lowercase slug/);
    expect(() =>
      parse({ projects: [project({ boards: [board({ flow: 'agile-ish' })] })] }),
    ).toThrow(/unknown flow "agile-ish"/);
  });

  it('names both owners of a duplicate prefix', () => {
    const dup = {
      projects: [
        project({ slug: 'alpha', boards: [board({ prefix: 'SAME' })] }),
        project({ slug: 'beta', boards: [board({ slug: 'other', prefix: 'SAME' })] }),
      ],
    };
    expect(() => parse(dup)).toThrow(ProjectsConfigError);
    expect(() => parse(dup)).toThrow(/"SAME" used by both alpha\/eng and beta\/other/);
  });
});

describe('ProjectsRegistry.extractTicketKeys', () => {
  const registry = new ProjectsRegistry(
    parse({
      projects: [
        project({ boards: [board({ prefix: 'FOOD' }), board({ slug: 'b', prefix: 'FOOD-ENG' })] }),
      ],
    }),
  );

  it('matches whole keys, longest prefix first, once each', () => {
    expect(registry.extractTicketKeys('fix/FOOD-ENG-104 and FOOD-ENG-104, FOOD-7')).toEqual([
      'FOOD-ENG-104',
      'FOOD-7',
    ]);
  });

  it('ignores lowercase keys and bare numbers', () => {
    expect(registry.extractTicketKeys('food-eng-1 1234')).toEqual([]);
    expect(registry.extractTicketKeys('')).toEqual([]);
  });
});
