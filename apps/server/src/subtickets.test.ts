// Sub-tickets: one level under a ticket.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TicketSchema, type Ticket } from '@officepm/shared';
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
      boards: [
        {
          slug: 'eng',
          name: 'Engineering',
          prefix: 'FOOD-ENG',
          flow: 'kanban',
          statuses: ['Backlog', 'In Progress', 'Review', 'Done'],
          types: ['epic', 'task', 'bug'],
          done_statuses: ['Done'],
        },
        {
          slug: 'des',
          name: 'Design',
          prefix: 'FOOD-DES',
          flow: 'kanban',
          statuses: ['Backlog', 'Design', 'Done'],
          types: ['task'],
          done_statuses: ['Done'],
        },
      ],
    },
    {
      slug: 'acme',
      name: 'Acme',
      boards: [
        {
          slug: 'eng',
          name: 'Engineering',
          prefix: 'ACME-ENG',
          flow: 'kanban',
          statuses: ['Backlog', 'Done'],
          types: ['task'],
          done_statuses: ['Done'],
        },
      ],
    },
  ],
};

const PASSWORD = 'unit-test-password';

class Client {
  cookie = '';
  constructor(private readonly app: ReturnType<typeof createApp>) {}

  async call(method: string, url: string, body?: unknown) {
    const res = await this.app.request(url, {
      method,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const text = await res.text();
    // Loosely typed on purpose: each test reads the few fields it cares about.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, text, json: (text ? JSON.parse(text) : null) as any };
  }

  async login(email: string) {
    const res = await this.call('POST', '/api/login', { email, password: PASSWORD });
    expect(res.status).toBe(200);
    return this;
  }
}

describe('sub-tickets', () => {
  let dir: string;
  let ctx: AppContext;
  let app: ReturnType<typeof createApp>;
  let admin: Client;
  let maya: Client;
  let sam: Client;
  let events: string[];
  let unsubscribe: () => void;
  const id = { maya: 0, sam: 0, tunde: 0 };

  const newTicket = async (over: Record<string, unknown> = {}): Promise<Ticket> => {
    const res = await admin.call('POST', '/api/tickets', {
      project_slug: 'food',
      board_slug: 'eng',
      title: 'Checkout flow',
      type: 'task',
      ...over,
    });
    expect(res.status).toBe(201);
    return TicketSchema.parse(res.json);
  };
  const detail = async (key: string) => (await admin.call('GET', `/api/tickets/${key}`)).json;
  const sub = (key: string, body: unknown, who: Client = maya) =>
    who.call('POST', `/api/tickets/${key}/subtickets`, body);
  const rows = (sql: string, ...args: unknown[]) => ctx.db.raw.prepare(sql).all(...args);

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-collab-'));
    ctx = {
      config: loadConfig({ PM_DATA_DIR: dir, PM_TOKEN: 'tok', ADMIN_PASSWORD: PASSWORD }),
      db: openDatabase({ filename: ':memory:' }),
      projects: new ProjectsRegistry(parseProjectsConfig(JSON.stringify(PROJECTS))),
      events: new EventBus(),
      dashboardCache: new Map(),
    };
    seedBoards(ctx);
    await bootstrapAdmin(ctx);
    app = createApp(ctx);
    admin = await new Client(app).login('admin@officepm.local');
    for (const [email, name, department] of [
      ['maya@x.test', 'Maya Okafor', 'Design'],
      ['sam@x.test', 'Sam Adeyemi', 'Engineering'],
      ['tunde@x.test', 'Tunde Bakare', 'Engineering'],
    ] as const) {
      const res = await admin.call('POST', '/api/users', {
        email,
        name,
        password: PASSWORD,
        department,
      });
      expect(res.status).toBe(201);
    }
    maya = await new Client(app).login('maya@x.test');
    sam = await new Client(app).login('sam@x.test');
    const people = (await sam.call('GET', '/api/people')).json as Array<{
      id: number;
      name: string;
    }>;
    const idOf = (name: string) => people.find((p) => p.name === name)!.id;
    id.maya = idOf('Maya Okafor');
    id.sam = idOf('Sam Adeyemi');
    id.tunde = idOf('Tunde Bakare');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => {
    const seen: string[] = [];
    events = seen;
    unsubscribe = ctx.events.subscribe((chunk) => seen.push(chunk));
  });
  afterEach(() => unsubscribe());

  it('creates a sub-ticket on the same board, with its own key and the first status', async () => {
    const parent = await newTicket({ title: 'Parent' });
    const res = await sub(parent.key, { title: 'Write the form' });
    expect(res.status).toBe(201);
    const child = TicketSchema.parse(res.json);
    expect(child.key).not.toBe(parent.key);
    expect(child.key.startsWith('FOOD-ENG-')).toBe(true);
    expect(child.subticket_of).toBe(parent.key);
    expect(child.board_slug).toBe('eng');
    expect(child.status).toBe('Backlog');
    expect(child.type).toBe('task');
    expect(child.parent_key).toBeNull();
  });

  it('announces the new sub-ticket as ticket.created', async () => {
    const parent = await newTicket();
    events.length = 0;
    await sub(parent.key, { title: 'One' });
    expect(events.map((e) => /^event: (\S+)/.exec(e)?.[1])).toEqual(['ticket.created']);
  });

  it('accepts a type, an assignee and refuses a type the board does not have', async () => {
    const parent = await newTicket();
    const ok = await sub(parent.key, { title: 'Bug', type: 'bug', assignee: 'sam@x.test' });
    expect(ok.json).toMatchObject({ type: 'bug', assignee: 'sam@x.test' });
    expect((await sub(parent.key, { title: 'x', type: 'story' })).status).toBe(400);
  });

  it('needs a title, a session and an existing parent', async () => {
    const parent = await newTicket();
    expect((await sub(parent.key, {})).status).toBe(400);
    expect((await sub(parent.key, { title: '   ' })).status).toBe(400);
    expect((await sub(parent.key, { title: 7 })).status).toBe(400);
    expect((await sub('NOPE-1', { title: 'x' })).status).toBe(404);
    expect((await sub(parent.key, { title: 'x' }, new Client(app))).status).toBe(401);
  });

  it('refuses an epic as a sub-ticket and an epic as a parent', async () => {
    const epic = await newTicket({ type: 'epic', title: 'Epic' });
    const parent = await newTicket();
    const asChild = await sub(parent.key, { title: 'x', type: 'epic' });
    expect(asChild.status).toBe(400);
    expect(asChild.json.error).toMatch(/epic/);
    const underEpic = await sub(epic.key, { title: 'x' });
    expect(underEpic.status).toBe(409);
    expect(underEpic.json.error).toMatch(/epic/);
  });

  it('allows one level only: a sub-ticket cannot have its own sub-tickets', async () => {
    const parent = await newTicket();
    const child = (await sub(parent.key, { title: 'child' })).json as Ticket;
    const res = await sub(child.key, { title: 'grandchild' });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/one level/);
    expect(rows('SELECT key FROM tickets WHERE subticket_of = ?', child.key)).toHaveLength(0);
  });

  it('reports sub-tickets and progress on the parent detail, with names and no emails', async () => {
    const parent = await newTicket({ title: 'Parent' });
    const a = (await sub(parent.key, { title: 'A', assignee: 'sam@x.test' })).json as Ticket;
    await sub(parent.key, { title: 'B', assignee: 'ghost@x.test' });
    await sub(parent.key, { title: 'C' });
    await admin.call('PATCH', `/api/tickets/${a.key}`, { status: 'Done' });
    const d = await detail(parent.key);
    expect(d.progress).toEqual({ done: 1, total: 3 });
    expect(d.subtickets).toHaveLength(3);
    expect(d.subtickets[0]).toEqual({
      key: a.key,
      title: 'A',
      status: 'Done',
      type: 'task',
      assignee_name: 'Sam Adeyemi',
    });
    // A bare email with no user behind it is not echoed back as a name.
    expect(d.subtickets[1].assignee_name).toBeNull();
    expect(d.subtickets[2].assignee_name).toBeNull();
    expect(JSON.stringify(d.subtickets)).not.toContain('@');
  });

  it('shows progress on the board list, and none for a ticket without sub-tickets', async () => {
    const parent = await newTicket({ title: 'Has kids' });
    const lone = await newTicket({ title: 'Alone' });
    await sub(parent.key, { title: 'k1' });
    const list = (await admin.call('GET', '/api/tickets?project=food&board=eng')).json as Array<{
      key: string;
      progress?: { done: number; total: number };
    }>;
    expect(list.find((t) => t.key === parent.key)!.progress).toEqual({ done: 0, total: 1 });
    expect(list.find((t) => t.key === lone.key)!.progress).toEqual({ done: 0, total: 0 });
  });

  it('counts done by the sub-ticket board done statuses and recounts after a delete', async () => {
    const parent = await newTicket();
    const k1 = (await sub(parent.key, { title: 'k1' })).json as Ticket;
    const k2 = (await sub(parent.key, { title: 'k2' })).json as Ticket;
    await admin.call('PATCH', `/api/tickets/${k1.key}`, { status: 'Review' });
    expect((await detail(parent.key)).progress).toEqual({ done: 0, total: 2 });
    await admin.call('PATCH', `/api/tickets/${k1.key}`, { status: 'Done' });
    await admin.call('DELETE', `/api/tickets/${k2.key}`);
    expect((await detail(parent.key)).progress).toEqual({ done: 1, total: 1 });
  });

  it('orphans the children when the parent is deleted, as epics do, and keeps them', async () => {
    const parent = await newTicket();
    const child = (await sub(parent.key, { title: 'child' })).json as Ticket;
    expect((await admin.call('DELETE', `/api/tickets/${parent.key}`)).status).toBe(200);
    const after = await detail(child.key);
    expect(after.subticket_of).toBeNull();
    expect(after.title).toBe('child');
  });

  it('leaves the epic relation alone: a sub-ticket can also belong to an epic', async () => {
    const epic = await newTicket({ type: 'epic', title: 'Epic' });
    const parent = await newTicket({ parent_key: epic.key });
    const child = (await sub(parent.key, { title: 'child' })).json as Ticket;
    expect(child.parent_key).toBeNull();
    expect((await detail(parent.key)).parent_key).toBe(epic.key);
    // The epic's children are still found through parent_key, sub-tickets are not among them.
    expect(rows('SELECT key FROM tickets WHERE parent_key = ?', epic.key)).toEqual([
      { key: parent.key },
    ]);
  });

  describe('attaching and detaching an existing ticket', () => {
    const attach = (key: string, parent_key: string | null, who: Client = maya) =>
      who.call('PUT', `/api/tickets/${key}/subticket-of`, { parent_key });

    it('attaches a ticket of the same project, and detaches it again', async () => {
      const parent = await newTicket();
      const other = await newTicket({ title: 'Loose' });
      const res = await attach(other.key, parent.key);
      expect(res.status).toBe(200);
      expect(res.json.subticket_of).toBe(parent.key);
      expect((await detail(parent.key)).progress.total).toBe(1);
      const off = await attach(other.key, null);
      expect(off.json.subticket_of).toBeNull();
      expect((await detail(parent.key)).progress.total).toBe(0);
    });

    it('can attach across boards of the same project', async () => {
      const parent = await newTicket();
      const design = await newTicket({ board_slug: 'des', title: 'Mock' });
      expect((await attach(design.key, parent.key)).status).toBe(200);
    });

    it('refuses a ticket as its own parent', async () => {
      const t = await newTicket();
      const res = await attach(t.key, t.key);
      expect(res.status).toBe(409);
      expect(res.json.error).toMatch(/own/);
    });

    it('refuses a parent in another project', async () => {
      const parent = await newTicket();
      const foreign = await newTicket({ project_slug: 'acme', board_slug: 'eng' });
      const res = await attach(foreign.key, parent.key);
      expect(res.status).toBe(409);
      expect(res.json.error).toMatch(/project/);
      expect((await detail(foreign.key)).subticket_of).toBeNull();
    });

    it('refuses an epic as the child and as the parent', async () => {
      const epic = await newTicket({ type: 'epic' });
      const t = await newTicket();
      expect((await attach(epic.key, t.key)).status).toBe(409);
      expect((await attach(t.key, epic.key)).status).toBe(409);
    });

    it('refuses a third level in both directions', async () => {
      const top = await newTicket({ title: 'top' });
      const mid = (await sub(top.key, { title: 'mid' })).json as Ticket;
      const loose = await newTicket({ title: 'loose' });
      // A sub-ticket as parent.
      expect((await attach(loose.key, mid.key)).status).toBe(409);
      // A ticket that has sub-tickets becoming a sub-ticket itself.
      const other = await newTicket({ title: 'other' });
      expect((await attach(top.key, other.key)).status).toBe(409);
    });

    it('404s on an unknown ticket or parent, 400s on a bad body, 401s without a session', async () => {
      const t = await newTicket();
      expect((await attach('NOPE-1', t.key)).status).toBe(404);
      expect((await attach(t.key, 'NOPE-1')).status).toBe(404);
      expect((await maya.call('PUT', `/api/tickets/${t.key}/subticket-of`, {})).status).toBe(400);
      expect((await attach(t.key, t.key, new Client(app))).status).toBe(401);
    });
  });

  it('refuses to turn a sub-ticket, or a ticket with sub-tickets, into an epic by PATCH', async () => {
    const parent = await newTicket();
    const child = (await sub(parent.key, { title: 'child' })).json as Ticket;
    expect((await admin.call('PATCH', `/api/tickets/${child.key}`, { type: 'epic' })).status).toBe(
      409,
    );
    expect((await admin.call('PATCH', `/api/tickets/${parent.key}`, { type: 'epic' })).status).toBe(
      409,
    );
    // Plain PATCH of anything else is unchanged, status included.
    expect(
      (await admin.call('PATCH', `/api/tickets/${parent.key}`, { status: 'Done' })).status,
    ).toBe(200);
  });

  it('treats a level of epic as an epic: no sub-ticket role, by PATCH, attach or create', async () => {
    const patch = (key: string, body: Record<string, unknown>) =>
      admin.call('PATCH', `/api/tickets/${key}`, body);
    const parent = await newTicket();
    const child = (await sub(parent.key, { title: 'child' })).json as Ticket;
    // A sub-ticket, or a ticket with sub-tickets, cannot be given the epic level.
    expect((await patch(child.key, { level: 'epic' })).status).toBe(409);
    expect((await patch(parent.key, { level: 'epic' })).status).toBe(409);
    expect((await detail(child.key)).level).not.toBe('epic');
    expect((await detail(parent.key)).level).not.toBe('epic');
    // A ticket that already has the epic level cannot be attached or hold sub-tickets.
    const lvl = await newTicket({ title: 'Level epic' });
    expect((await patch(lvl.key, { level: 'epic' })).status).toBe(200);
    const loose = await newTicket({ title: 'Loose' });
    expect(
      (await maya.call('PUT', `/api/tickets/${lvl.key}/subticket-of`, { parent_key: loose.key }))
        .status,
    ).toBe(409);
    expect(
      (await maya.call('PUT', `/api/tickets/${loose.key}/subticket-of`, { parent_key: lvl.key }))
        .status,
    ).toBe(409);
    expect((await sub(lvl.key, { title: 'x' })).status).toBe(409);
  });

  describe('closing a parent in a handoff', () => {
    const approveToDone = (key: string, extra: Record<string, unknown> = {}) =>
      maya.call('POST', `/api/tickets/${key}/handoff`, {
        decision: 'approve',
        to_status: 'Done',
        ...extra,
      });

    it('warns, with the open count, until the caller says close anyway', async () => {
      const parent = await newTicket({ status: 'Review' });
      const k1 = (await sub(parent.key, { title: 'k1' })).json as Ticket;
      await sub(parent.key, { title: 'k2' });
      await admin.call('PATCH', `/api/tickets/${k1.key}`, { status: 'Done' });
      const res = await approveToDone(parent.key);
      expect(res.status).toBe(409);
      expect(res.json.error).toMatch(/1 sub-ticket is still open/);
      expect((await detail(parent.key)).status).toBe('Review');
      const forced = await approveToDone(parent.key, { close_anyway: true });
      expect(forced.status).toBe(200);
      expect(forced.json.ticket.status).toBe('Done');
    });

    it('does not warn when every sub-ticket is done, or the move is not into a done status', async () => {
      const parent = await newTicket({ status: 'Backlog' });
      const k1 = (await sub(parent.key, { title: 'k1' })).json as Ticket;
      const notDone = await maya.call('POST', `/api/tickets/${parent.key}/handoff`, {
        decision: 'approve',
        to_status: 'In Progress',
      });
      expect(notDone.status).toBe(200);
      await admin.call('PATCH', `/api/tickets/${k1.key}`, { status: 'Done' });
      expect((await approveToDone(parent.key)).status).toBe(200);
    });

    it('does not warn for a ticket with no sub-tickets, and a sub-ticket closes freely', async () => {
      const lone = await newTicket({ status: 'Review' });
      expect((await approveToDone(lone.key)).status).toBe(200);
      const parent = await newTicket();
      const child = (await sub(parent.key, { title: 'c', type: 'task' })).json as Ticket;
      await admin.call('PATCH', `/api/tickets/${child.key}`, { status: 'Review' });
      expect((await approveToDone(child.key)).status).toBe(200);
    });

    it('refuses a close_anyway that is not a boolean', async () => {
      const parent = await newTicket({ status: 'Review' });
      expect((await approveToDone(parent.key, { close_anyway: 'yes' })).status).toBe(400);
    });
  });
});
