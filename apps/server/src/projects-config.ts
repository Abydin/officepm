import fs from 'node:fs';
import { FLOW_IDS, type FlowId } from '@officepm/shared';

/** Thrown for a projects.json the server must refuse to start on. */
export class ProjectsConfigError extends Error {}

/**
 * A board as declared in projects.json, after defaults are filled in. Unknown
 * keys are kept because GET /api/admin/projects returns the whole file as v1 does.
 */
export interface BoardConfig {
  slug: string;
  name: string;
  prefix: string;
  icon?: string;
  flow: FlowId;
  statuses: string[];
  types: string[];
  has_github: boolean;
  agile: boolean;
  points: boolean;
  wip_limits: Record<string, number>;
  done_statuses: string[];
  definition_of_done?: string[];
  definition_of_ready?: string[];
  [extra: string]: unknown;
}

export interface ProjectConfig {
  slug: string;
  name: string;
  description?: string;
  boards: BoardConfig[];
  [extra: string]: unknown;
}

export interface ProjectsConfig {
  projects: ProjectConfig[];
  [extra: string]: unknown;
}

export interface BoardRef {
  project: ProjectConfig;
  board: BoardConfig;
}

const SLUG = /^[a-z0-9-]+$/;
const PREFIX = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const VALID_FLOWS = new Set<string>(FLOW_IDS);

/**
 * Parses and validates projects.json text. The messages are v1's word for word:
 * the office admin edits this file by hand and the conformance suite matches
 * on them. Defaults are written into the parsed object, as v1 does.
 */
export function parseProjectsConfig(raw: string): ProjectsConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ProjectsConfigError('projects.json is not valid JSON: ' + (e as Error).message);
  }
  const root = parsed as ProjectsConfig | null;
  if (!root || !Array.isArray(root.projects)) {
    throw new ProjectsConfigError('projects.json must have a top-level "projects" array');
  }

  const seenProjectSlugs = new Set<string>();
  const seenPrefixes = new Map<string, string>(); // prefix -> "projectSlug/boardSlug"

  for (const project of root.projects) {
    if (!project || typeof project.slug !== 'string' || !SLUG.test(project.slug)) {
      throw new ProjectsConfigError(
        'every project needs a lowercase slug (a-z0-9-); offending project: ' +
          JSON.stringify(project?.name || project),
      );
    }
    if (seenProjectSlugs.has(project.slug)) {
      throw new ProjectsConfigError('duplicate project slug: ' + project.slug);
    }
    seenProjectSlugs.add(project.slug);
    if (!project.name)
      throw new ProjectsConfigError('project "' + project.slug + '" is missing name');
    if (!Array.isArray(project.boards) || project.boards.length === 0) {
      throw new ProjectsConfigError('project "' + project.slug + '" must have at least one board');
    }

    const seenBoardSlugs = new Set<string>();
    for (const board of project.boards) {
      const where = project.slug + '/' + board?.slug;
      if (!board || typeof board.slug !== 'string' || !SLUG.test(board.slug)) {
        throw new ProjectsConfigError(
          'board in project "' + project.slug + '" needs a lowercase slug',
        );
      }
      if (seenBoardSlugs.has(board.slug)) {
        throw new ProjectsConfigError(
          'duplicate board slug "' + board.slug + '" in project "' + project.slug + '"',
        );
      }
      seenBoardSlugs.add(board.slug);
      if (!board.prefix || !PREFIX.test(board.prefix)) {
        throw new ProjectsConfigError(
          'board "' + where + '" needs an uppercase prefix like FOOD-ENG',
        );
      }
      const owner = seenPrefixes.get(board.prefix);
      if (owner !== undefined) {
        throw new ProjectsConfigError(
          'duplicate board prefix "' +
            board.prefix +
            '" used by both ' +
            owner +
            ' and ' +
            where +
            ' -- board prefixes must be globally unique (PRD 5, 15)',
        );
      }
      seenPrefixes.set(board.prefix, where);
      if (!board.flow) board.flow = 'kanban';
      if (!VALID_FLOWS.has(board.flow)) {
        throw new ProjectsConfigError(
          'board "' +
            where +
            '" has unknown flow "' +
            board.flow +
            '" (must be one of ' +
            FLOW_IDS.join(', ') +
            ')',
        );
      }
      if (!Array.isArray(board.statuses) || board.statuses.length === 0) {
        throw new ProjectsConfigError(
          'board "' + where + '" must declare a non-empty statuses array',
        );
      }
      if (!Array.isArray(board.types) || board.types.length === 0) {
        throw new ProjectsConfigError('board "' + where + '" must declare a non-empty types array');
      }
      board.has_github = !!board.has_github;
      board.agile = !!board.agile;
      board.points = !!board.points;
      board.wip_limits = board.wip_limits || {};
      // PRD 6.11 / 17.6: "done" is the last status unless done_statuses overrides it.
      board.done_statuses =
        Array.isArray(board.done_statuses) && board.done_statuses.length
          ? board.done_statuses
          : [board.statuses[board.statuses.length - 1] as string];
    }
  }
  return root;
}

export function readProjectsConfig(file: string): ProjectsConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new ProjectsConfigError(
      'cannot read projects.json at ' + file + ' (' + (e as Error).message + ')',
    );
  }
  return parseProjectsConfig(raw);
}

/** Lookups over the validated config. The config is immutable after startup. */
export class ProjectsRegistry {
  constructor(readonly config: ProjectsConfig) {}

  allBoards(): BoardRef[] {
    return this.config.projects.flatMap((project) =>
      project.boards.map((board) => ({ project, board })),
    );
  }

  findProject(slug: unknown): ProjectConfig | undefined {
    return this.config.projects.find((p) => p.slug === slug);
  }

  findBoard(projectSlug: unknown, boardSlug: unknown): BoardRef | null {
    const project = this.findProject(projectSlug);
    const board = project?.boards.find((b) => b.slug === boardSlug);
    return project && board ? { project, board } : null;
  }

  findBoardByPrefix(prefix: string): BoardRef | null {
    return this.allBoards().find(({ board }) => board.prefix === prefix) ?? null;
  }

  /**
   * Matches whole ticket keys such as FOOD-ENG-104. Built from the real prefixes
   * rather than the PRD's [A-Z]+-\d+, which would capture only "ENG-104". Longest
   * prefix first so a short prefix never wins a partial match.
   */
  extractTicketKeys(text: string): string[] {
    if (!text) return [];
    const escaped = this.allBoards()
      .map(({ board }) => board.prefix)
      .sort((a, b) => b.length - a.length)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp('\\b(' + escaped.join('|') + ')-\\d+\\b', 'g');
    return Array.from(new Set(text.match(re) ?? []));
  }
}
