import { and, eq } from 'drizzle-orm';
import {
  SettingsPatchRequestSchema,
  type Board,
  type BoardSettings,
  type Project,
} from '@officepm/shared';
import type { AppContext, JsonBody } from '../../context.js';
import { schema } from '../../db/index.js';
import { notFound } from '../../http/errors.js';
import { requireShape } from '../../http/validate.js';
import type { BoardConfig, ProjectConfig } from '../../projects-config.js';

export function publicBoard(board: BoardConfig): Board {
  return {
    slug: board.slug,
    name: board.name,
    prefix: board.prefix,
    icon: board.icon || 'layout',
    flow: board.flow,
    statuses: board.statuses,
    types: board.types,
    points: !!board.points,
    has_github: !!board.has_github,
    agile: !!board.agile,
    wip_limits: board.wip_limits || {},
    done_statuses: board.done_statuses,
  };
}

export function publicProject(project: ProjectConfig): Project {
  return {
    slug: project.slug,
    name: project.name,
    description: project.description || '',
    boards: project.boards.map(publicBoard),
  };
}

export function createProjectService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { boardSettings } = schema;
  const { projects } = ctx;

  const settingsWhere = (project: string, board: string) =>
    and(eq(boardSettings.project_slug, project), eq(boardSettings.board_slug, board));

  function requireBoard(projectSlug: string, boardSlug: string) {
    const found = projects.findBoard(projectSlug, boardSlug);
    if (!found) throw notFound('board not found');
    return found;
  }

  return {
    list: (): Project[] => projects.config.projects.map(publicProject),

    get(slug: string): Project {
      const project = projects.findProject(slug);
      if (!project) throw notFound('project not found');
      return publicProject(project);
    },

    getBoard(slug: string, boardSlug: string): Board {
      return publicBoard(requireBoard(slug, boardSlug).board);
    },

    getSettings(slug: string, boardSlug: string): BoardSettings {
      requireBoard(slug, boardSlug);
      const row = orm.select().from(boardSettings).where(settingsWhere(slug, boardSlug)).get();
      if (!row) throw notFound('board settings not found');
      return {
        flow: row.flow as BoardSettings['flow'],
        agile_enabled: !!row.agile_enabled,
        wip_limits: JSON.parse(row.wip_limits || '{}'),
        definition_of_done: JSON.parse(row.definition_of_done || '[]'),
        definition_of_ready: JSON.parse(row.definition_of_ready || '[]'),
      };
    },

    /** Only the runtime-editable settings; the flow stays owned by projects.json. */
    patchSettings(slug: string, boardSlug: string, body: JsonBody): void {
      requireBoard(slug, boardSlug);
      const existing = orm.select().from(boardSettings).where(settingsWhere(slug, boardSlug)).get();
      if (!existing) throw notFound('board settings not found');
      requireShape(SettingsPatchRequestSchema, body);
      orm
        .update(boardSettings)
        .set({
          wip_limits:
            body.wip_limits !== undefined ? JSON.stringify(body.wip_limits) : existing.wip_limits,
          definition_of_done:
            body.definition_of_done !== undefined
              ? JSON.stringify(body.definition_of_done)
              : existing.definition_of_done,
          definition_of_ready:
            body.definition_of_ready !== undefined
              ? JSON.stringify(body.definition_of_ready)
              : existing.definition_of_ready,
        })
        .where(settingsWhere(slug, boardSlug))
        .run();
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
