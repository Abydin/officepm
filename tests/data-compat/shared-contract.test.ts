// The shared Zod schemas are written from reading the v1 server. This checks them
// against what a real, seeded v1 server actually sends, so they cannot drift from
// the contract the conformance suite pins.
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  BoardSettingsSchema,
  BoardVelocitySchema,
  BurndownSchema,
  CommentSchema,
  DashboardSchema,
  DodItemSchema,
  DocSchema,
  ErrorBodySchema,
  OverviewRowSchema,
  ProjectSchema,
  RetroSchema,
  RetroWithCardsSchema,
  SprintSchema,
  TicketLinkSchema,
  TicketSchema,
  UserListItemSchema,
  UserSchema,
  FLOW_CAPABILITIES,
  ALLOWED_SPRINT_KINDS,
} from '@officepm/shared';
import { DEMO_LOGIN, client, startLegacy, type LegacyServer } from './support/legacy.js';
import { seededFixture, type Fixture } from './support/fixtures.js';

let fx: Fixture;
let srv: LegacyServer;
let c: ReturnType<typeof client>;

async function getJson(url: string): Promise<unknown> {
  const res = await c.get(url);
  expect(res.status, url).toBe(200);
  return res.json();
}

function expectEach<T>(schema: ZodType<T>, rows: unknown, label: string) {
  expect(Array.isArray(rows), label).toBe(true);
  expect((rows as unknown[]).length, `${label} is not empty`).toBeGreaterThan(0);
  for (const row of rows as unknown[]) {
    const parsed = schema.safeParse(row);
    expect(parsed.success, `${label}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  }
}

beforeAll(async () => {
  fx = seededFixture();
  srv = await startLegacy(fx.dataDir);
  c = client(srv.base);
  await c.login(DEMO_LOGIN);
});
afterAll(async () => {
  await srv?.stop();
  if (fx) fs.rmSync(fx.dataDir, { recursive: true, force: true });
});

describe('shared schemas parse real v1 responses', () => {
  it('user shapes', async () => {
    expect(UserSchema.parse(await getJson('/api/me')).isAdmin).toBe(true);
    expectEach(UserListItemSchema, await getJson('/api/users'), 'GET /api/users');
  });

  it('projects, boards and board settings', async () => {
    const projects = await getJson('/api/projects');
    expectEach(ProjectSchema, projects, 'GET /api/projects');
    for (const p of projects as Array<{
      slug: string;
      boards: Array<{ slug: string; flow: keyof typeof FLOW_CAPABILITIES }>;
    }>) {
      for (const b of p.boards) {
        BoardSettingsSchema.parse(
          await getJson(`/api/projects/${p.slug}/boards/${b.slug}/settings`),
        );
        BoardVelocitySchema.parse(
          await getJson(`/api/projects/${p.slug}/boards/${b.slug}/velocity`),
        );
        expect(FLOW_CAPABILITIES[b.flow], String(b.flow)).toBeDefined();
      }
    }
  });

  it('tickets in API shape, with comments, links, dod and docs', async () => {
    const tickets = (await getJson('/api/tickets')) as Array<{ key: string }>;
    expectEach(TicketSchema, tickets, 'GET /api/tickets');
    TicketSchema.parse(await getJson('/api/tickets/' + tickets[0]!.key));
    const comments = (
      await Promise.all(tickets.map((t) => getJson(`/api/tickets/${t.key}/comments`)))
    ).flat();
    expectEach(CommentSchema, comments, 'comments');
    expectEach(DodItemSchema, await getJson('/api/tickets/FOOD-ENG-1/dod'), 'dod');
    expectEach(DocSchema, await getJson('/api/projects/food/docs'), 'docs');
    const links = await Promise.all(tickets.map((t) => getJson(`/api/tickets/${t.key}/links`)));
    const any = links.flat();
    expect(any.length).toBeGreaterThan(0);
    for (const l of any) TicketLinkSchema.parse(l);
  });

  it('sprints, burndown and retros', async () => {
    const sprints = (await getJson('/api/projects/food/boards/eng/sprints')) as Array<{
      id: string;
      kind: string;
    }>;
    expectEach(SprintSchema, sprints, 'sprints');
    for (const s of sprints) {
      expect(ALLOWED_SPRINT_KINDS.scrum).toContain(s.kind);
      BurndownSchema.parse(await getJson(`/api/sprints/${s.id}/burndown`));
    }
    const retros = (await getJson('/api/projects/food/boards/eng/retros')) as Array<{ id: string }>;
    expectEach(RetroSchema, retros, 'retros');
    const full = RetroWithCardsSchema.parse(await getJson('/api/retros/' + retros[0]!.id));
    expect(full.cards.length).toBeGreaterThan(0);
  });

  it('overview and dashboard', async () => {
    expectEach(OverviewRowSchema, await getJson('/api/overview'), 'overview');
    const dash = DashboardSchema.parse(await getJson('/api/dashboard'));
    expect(dash.boards.length).toBe(7);
  });

  it('the error shape is { error }', async () => {
    const res = await c.get('/api/tickets/NOPE-1');
    expect(res.status).toBe(404);
    ErrorBodySchema.parse(await res.json());
  });
});
