import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BoardVelocitySchema,
  BurndownSchema,
  CommentSchema,
  DashboardSchema,
  ErrorBodySchema,
  GithubHookResultSchema,
  OverviewRowSchema,
  ProjectSchema,
  RetroWithCardsSchema,
  SprintSchema,
  TicketSchema,
  UserSchema,
} from '@officepm/shared';
import {
  bootstrapAdmin,
  createApp,
  EventBus,
  loadConfig,
  openDatabase,
  ProjectsRegistry,
  seedBoards,
} from './index.js';
import { parseProjectsConfig } from './projects-config.js';
import type { AppContext } from './context.js';

const PROJECTS = {
  projects: [
    {
      slug: 'food',
      name: 'Food',
      description: 'd',
      boards: [
        {
          slug: 'eng',
          name: 'Engineering',
          prefix: 'FOOD-ENG',
          flow: 'scrum',
          agile: true,
          points: true,
          has_github: true,
          statuses: ['Backlog', 'In Progress', 'Code Review', 'QA', 'Done'],
          types: ['task', 'bug'],
          definition_of_done: ['tested'],
        },
      ],
    },
  ],
};

// These tests run the real app in-process and check every response against the
// Zod schemas in packages/shared, so a drifting handler fails here, not in the web client.
describe('API contract (shared Zod schemas)', () => {
  let dir: string;
  let cookie = '';
  let app: ReturnType<typeof createApp>;

  const call = async (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(url, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    return { status: res.status, json: (await res.json()) as unknown };
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-app-'));
    const config = loadConfig({
      PM_DATA_DIR: dir,
      PM_TOKEN: 'tok',
      ADMIN_PASSWORD: 'unit-test-password',
    });
    const ctx: AppContext = {
      config,
      db: openDatabase({ filename: ':memory:' }),
      projects: new ProjectsRegistry(parseProjectsConfig(JSON.stringify(PROJECTS))),
      events: new EventBus(),
      dashboardCache: new Map(),
    };
    seedBoards(ctx);
    await bootstrapAdmin(ctx);
    app = createApp(ctx);
    expect(
      (
        await call('POST', '/api/login', {
          email: 'admin@officepm.local',
          password: 'unit-test-password',
        })
      ).status,
    ).toBe(200);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('returns the shapes the shared schemas describe', async () => {
    UserSchema.parse((await call('GET', '/api/me')).json);
    ProjectSchema.array().parse((await call('GET', '/api/projects')).json);

    const created = TicketSchema.parse(
      (
        await call('POST', '/api/tickets', {
          project_slug: 'food',
          board_slug: 'eng',
          title: 'contract',
          type: 'task',
          points: 3,
          labels: ['a'],
        })
      ).json,
    );
    expect(created.key).toBe('FOOD-ENG-1');
    TicketSchema.parse(
      (await call('PATCH', '/api/tickets/FOOD-ENG-1', { priority: 'high', status: 'QA' })).json,
    );
    CommentSchema.parse(
      (await call('POST', '/api/tickets/FOOD-ENG-1/comments', { body: 'hi' })).json,
    );

    const sprint = SprintSchema.parse(
      (
        await call('POST', '/api/projects/food/boards/eng/sprints', {
          name: 'S1',
          status: 'active',
        })
      ).json,
    );
    await call('PATCH', '/api/tickets/FOOD-ENG-1', { sprint_id: sprint.id });
    BurndownSchema.parse((await call('GET', `/api/sprints/${sprint.id}/burndown`)).json);
    BoardVelocitySchema.parse((await call('GET', '/api/projects/food/boards/eng/velocity')).json);

    OverviewRowSchema.array().parse((await call('GET', '/api/overview')).json);
    DashboardSchema.parse((await call('GET', '/api/dashboard')).json);

    await call('PATCH', `/api/sprints/${sprint.id}`, { status: 'completed' });
    const retros = (await call('GET', '/api/projects/food/boards/eng/retros')).json as {
      id: string;
    }[];
    expect(retros).toHaveLength(1);
    RetroWithCardsSchema.parse((await call('GET', `/api/retros/${retros[0]!.id}`)).json);
  });

  it('moves tickets from a CI webhook, but only with the shared token', async () => {
    const denied = await call(
      'POST',
      '/api/github/pr-opened',
      { branch: 'FOOD-ENG-1' },
      { 'x-pm-token': 'wrong' },
    );
    expect(denied.status).toBe(401);
    ErrorBodySchema.parse(denied.json);

    const ok = await call(
      'POST',
      '/api/github/pr-opened',
      { branch: 'fix/FOOD-ENG-1' },
      { 'x-pm-token': 'tok' },
    );
    expect(GithubHookResultSchema.parse(ok.json).matched).toEqual(['FOOD-ENG-1']);
    expect(TicketSchema.parse((await call('GET', '/api/tickets/FOOD-ENG-1')).json).status).toBe(
      'Code Review',
    );
  });

  it('answers errors as { error } with v1 status codes', async () => {
    for (const [method, url, body, status] of [
      ['GET', '/api/tickets/NOPE-1', undefined, 404],
      ['POST', '/api/tickets', { project_slug: 'nope' }, 400],
      ['GET', '/api/nope', undefined, 404],
    ] as const) {
      const res = await call(method, url, body);
      expect(res.status).toBe(status);
      ErrorBodySchema.parse(res.json);
    }
  });
});
