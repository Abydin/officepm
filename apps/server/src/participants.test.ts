// Participants: more people on a ticket besides its one assignee.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HandoffNoticeListSchema,
  ParticipantSchema,
  TicketSchema,
  type Ticket,
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

describe('participants', () => {
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
  const addPerson = (key: string, body: unknown, who: Client = maya) =>
    who.call('POST', `/api/tickets/${key}/participants`, body);
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

  it('adds a person with a role and returns only id, name, department and role', async () => {
    const t = await newTicket();
    const res = await addPerson(t.key, { user_id: id.sam, role: 'Backend' });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({
      id: id.sam,
      name: 'Sam Adeyemi',
      department: 'Engineering',
      role: 'Backend',
    });
    expect(Object.keys(ParticipantSchema.parse(res.json)).sort()).toEqual([
      'department',
      'id',
      'name',
      'role',
    ]);
  });

  it('never puts an email in a participants response or in the ticket detail field', async () => {
    const t = await newTicket();
    await addPerson(t.key, { user_id: id.sam, role: 'PM' });
    await addPerson(t.key, { user_id: id.tunde });
    const list = await maya.call('GET', `/api/tickets/${t.key}/participants`);
    expect(list.status).toBe(200);
    expect(list.text).not.toContain('@');
    const d = await detail(t.key);
    expect(JSON.stringify(d.participants)).not.toContain('@');
    expect(d.participants.map((p: { name: string }) => p.name)).toEqual([
      'Sam Adeyemi',
      'Tunde Bakare',
    ]);
  });

  it('lists participants on the board list too, for the card avatars', async () => {
    const t = await newTicket({ title: 'Listed' });
    await addPerson(t.key, { user_id: id.maya });
    const list = (await admin.call('GET', '/api/tickets?project=food&board=eng')).json as Array<{
      key: string;
      participants: unknown[];
    }>;
    expect(list.find((x) => x.key === t.key)!.participants).toHaveLength(1);
  });

  it('adding the same person again updates the role instead of duplicating', async () => {
    const t = await newTicket();
    await addPerson(t.key, { user_id: id.sam, role: 'Backend' });
    const again = await addPerson(t.key, { user_id: id.sam, role: 'Lead' });
    expect(again.status).toBe(200);
    expect(again.json.role).toBe('Lead');
    expect(rows('SELECT * FROM ticket_participants WHERE ticket_key = ?', t.key)).toHaveLength(1);
    const cleared = await addPerson(t.key, { user_id: id.sam, role: null });
    expect(cleared.json.role).toBeNull();
  });

  it.each([
    ['longer than 30 characters', 'x'.repeat(31)],
    ['a blank string', '   '],
    ['an empty string', ''],
    ['two lines', 'Front\nend'],
    ['a control character', 'Front\u0007end'],
    ['a bidi override', 'Front\u202Eend'],
    ['a zero width mark', 'Front\u200Bend'],
    ['not a string', 42],
  ])('rejects a role that is %s', async (_name, role) => {
    const t = await newTicket();
    const res = await addPerson(t.key, { user_id: id.sam, role });
    expect(res.status).toBe(400);
    expect(rows('SELECT * FROM ticket_participants WHERE ticket_key = ?', t.key)).toHaveLength(0);
  });

  it('trims the role and accepts exactly 30 characters', async () => {
    const t = await newTicket();
    expect((await addPerson(t.key, { user_id: id.sam, role: '  PM  ' })).json.role).toBe('PM');
    expect((await addPerson(t.key, { user_id: id.maya, role: 'y'.repeat(30) })).status).toBe(201);
  });

  it.each([
    ['missing', {}],
    ['a string', { user_id: '2' }],
    ['a fraction', { user_id: 1.5 }],
    ['an unknown user', { user_id: 99999 }],
  ])('rejects a user_id that is %s', async (_name, body) => {
    const t = await newTicket();
    expect((await addPerson(t.key, body)).status).toBe(400);
  });

  it('refuses the primary assignee as a participant', async () => {
    const t = await newTicket({ assignee: 'sam@x.test' });
    const res = await addPerson(t.key, { user_id: id.sam });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/assignee/);
  });

  it('needs a session and an existing ticket', async () => {
    const t = await newTicket();
    const anon = new Client(app);
    expect((await anon.call('GET', `/api/tickets/${t.key}/participants`)).status).toBe(401);
    expect((await addPerson(t.key, { user_id: id.sam }, anon)).status).toBe(401);
    expect((await anon.call('DELETE', `/api/tickets/${t.key}/participants/${id.sam}`)).status).toBe(
      401,
    );
    expect((await addPerson('NOPE-1', { user_id: id.sam })).status).toBe(404);
    expect((await maya.call('GET', '/api/tickets/NOPE-1/participants')).status).toBe(404);
  });

  it('removes a person, and only from the ticket named in the URL', async () => {
    const a = await newTicket({ title: 'A' });
    const b = await newTicket({ title: 'B' });
    await addPerson(a.key, { user_id: id.sam });
    await addPerson(b.key, { user_id: id.sam });
    // The person is on A only through A's URL: asking B's URL to remove them touches B alone.
    const res = await maya.call('DELETE', `/api/tickets/${b.key}/participants/${id.sam}`);
    expect(res.status).toBe(200);
    expect((await detail(a.key)).participants).toHaveLength(1);
    expect((await detail(b.key)).participants).toHaveLength(0);
    // A person who is not on this ticket is a 404, not a silent success.
    const again = await maya.call('DELETE', `/api/tickets/${b.key}/participants/${id.sam}`);
    expect(again.status).toBe(404);
    expect((await detail(a.key)).participants).toHaveLength(1);
    expect((await maya.call('DELETE', `/api/tickets/${a.key}/participants/abc`)).status).toBe(400);
  });

  it('is removed with the ticket', async () => {
    const t = await newTicket();
    await addPerson(t.key, { user_id: id.sam });
    expect((await admin.call('DELETE', `/api/tickets/${t.key}`)).status).toBe(200);
    expect(rows('SELECT * FROM ticket_participants WHERE ticket_key = ?', t.key)).toHaveLength(0);
  });

  it('announces a change on the event stream, with no names or emails in it', async () => {
    const t = await newTicket();
    events.length = 0;
    await addPerson(t.key, { user_id: id.sam, role: 'PM' });
    await maya.call('DELETE', `/api/tickets/${t.key}/participants/${id.sam}`);
    const parsed = events.map((e) => ({
      name: /^event: (\S+)/.exec(e)?.[1],
      data: JSON.parse(/data: (.*)/.exec(e)![1]!),
    }));
    expect(parsed.map((p) => p.name)).toEqual([
      'ticket.participants.changed',
      'ticket.participants.changed',
    ]);
    expect(parsed[0]!.data).toEqual({ key: t.key });
  });

  it('lists tickets you take part in under /api/my-tickets/participating, not ones you are assigned', async () => {
    const mine = await newTicket({ title: 'Mine', assignee: 'sam@x.test' });
    const other = await newTicket({ title: 'Other' });
    await addPerson(other.key, { user_id: id.sam });
    // Participant on a ticket they are also assigned to would be a duplicate row: not listed.
    ctx.db.raw
      .prepare(
        'INSERT INTO ticket_participants (ticket_key, user_id, role, added_by) VALUES (?, ?, NULL, 1)',
      )
      .run(mine.key, id.sam);
    const res = await sam.call('GET', '/api/my-tickets/participating');
    expect(res.status).toBe(200);
    const keys = (res.json as Ticket[]).map((t) => t.key);
    expect(keys).toContain(other.key);
    expect(keys).not.toContain(mine.key);
    // The assignee filter conformance relies on is unchanged.
    const assigned = (await sam.call('GET', '/api/my-tickets')).json as Ticket[];
    expect(assigned.map((t) => t.key)).toContain(mine.key);
    expect(assigned.map((t) => t.key)).not.toContain(other.key);
  });

  describe('in a handoff', () => {
    it('nudges every chosen person, keeps one primary and makes the rest participants', async () => {
      const t = await newTicket({ status: 'In Progress' });
      const res = await maya.call('POST', `/api/tickets/${t.key}/handoff`, {
        decision: 'approve',
        assignee_id: id.sam,
        participant_ids: [id.tunde, id.sam, id.tunde],
      });
      expect(res.status).toBe(200);
      expect(res.json.ticket.assignee).toBe('sam@x.test');
      const d = await detail(t.key);
      // The assignee is not duplicated as a participant; the repeated id is stored once.
      expect(d.participants.map((p: { name: string }) => p.name)).toEqual(['Tunde Bakare']);

      const tunde = await new Client(app).login('tunde@x.test');
      const forTunde = HandoffNoticeListSchema.parse(
        (await tunde.call('GET', '/api/handoffs/unread')).json,
      );
      expect(forTunde.map((n) => n.ticket_key)).toEqual([t.key]);
      const forSam = HandoffNoticeListSchema.parse(
        (await sam.call('GET', '/api/handoffs/unread')).json,
      );
      expect(forSam.map((n) => n.ticket_key)).toEqual([t.key]);
      // The sender is not nudged about their own handoff.
      expect((await maya.call('GET', '/api/handoffs/unread')).json).toEqual([]);

      await tunde.call('POST', `/api/tickets/${t.key}/handoffs/read`);
      expect((await tunde.call('GET', '/api/handoffs/unread')).json).toEqual([]);
      // Reading is per person.
      expect(
        HandoffNoticeListSchema.parse((await sam.call('GET', '/api/handoffs/unread')).json),
      ).toHaveLength(1);
    });

    it('keeps an existing participant role when the same person is nudged again', async () => {
      const t = await newTicket({ status: 'Backlog' });
      await addPerson(t.key, { user_id: id.tunde, role: 'Backend' });
      await maya.call('POST', `/api/tickets/${t.key}/handoff`, {
        decision: 'approve',
        participant_ids: [id.tunde],
      });
      expect((await detail(t.key)).participants[0].role).toBe('Backend');
    });

    it('refuses an unknown participant id and writes nothing', async () => {
      const t = await newTicket({ status: 'Backlog' });
      const res = await maya.call('POST', `/api/tickets/${t.key}/handoff`, {
        decision: 'approve',
        participant_ids: [id.sam, 99999],
      });
      expect(res.status).toBe(400);
      expect((await detail(t.key)).status).toBe('Backlog');
      expect((await detail(t.key)).participants).toHaveLength(0);
    });

    it('refuses a participant_ids that is not an array of integers', async () => {
      const t = await newTicket({ status: 'Backlog' });
      for (const bad of ['3', [1.5], ['a'], Array.from({ length: 21 }, (_, i) => i + 1)]) {
        const res = await maya.call('POST', `/api/tickets/${t.key}/handoff`, {
          decision: 'approve',
          participant_ids: bad,
        });
        expect(res.status).toBe(400);
      }
    });
  });

  it('answers 404 for the participants of a deleted ticket', async () => {
    const t = await newTicket();
    await addPerson(t.key, { user_id: id.sam });
    await admin.call('DELETE', `/api/tickets/${t.key}`);
    expect((await maya.call('GET', `/api/tickets/${t.key}/participants`)).status).toBe(404);
  });
});
