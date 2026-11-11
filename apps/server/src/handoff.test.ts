import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CommentSchema,
  HandoffNoticeListSchema,
  HandoffResultSchema,
  PersonListSchema,
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
          slug: 'des',
          name: 'Design',
          prefix: 'FOOD-DES',
          flow: 'kanban',
          statuses: ['Backlog', 'Design', 'Review', 'Done'],
          types: ['task'],
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
          flow: 'waterfall',
          statuses: ['Requirements', 'Design', 'Implementation', 'Verification'],
          types: ['task'],
        },
      ],
    },
  ],
};

const PASSWORD = 'unit-test-password';
const ADMIN = 'admin@officepm.local';

class Client {
  cookie = '';
  constructor(private readonly app: ReturnType<typeof createApp>) {}

  async call(method: string, url: string, body?: unknown) {
    const isForm = body instanceof FormData;
    const res = await this.app.request(url, {
      method,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body === undefined || isForm ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    // Loosely typed on purpose: each test reads the few fields it cares about, and the
    // ones that matter are also parsed with the shared schemas.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  }

  async login(email: string, password = PASSWORD) {
    const res = await this.call('POST', '/api/login', { email, password });
    expect(res.status).toBe(200);
    return this;
  }
}

describe('handoff', () => {
  let dir: string;
  let ctx: AppContext;
  let app: ReturnType<typeof createApp>;
  let admin: Client;
  let maya: Client; // designer
  let sam: Client; // frontend dev
  let tunde: Client; // second member of the Engineering department
  let events: string[];
  let unsubscribe: () => void;

  const newTicket = async (board = 'des', status?: string): Promise<Ticket> => {
    const project = board === 'des' ? 'food' : 'acme';
    const res = await admin.call('POST', '/api/tickets', {
      project_slug: project,
      board_slug: board,
      title: 'Logo refresh',
      type: 'task',
      ...(status ? { status } : {}),
    });
    expect(res.status).toBe(201);
    return TicketSchema.parse(res.json);
  };
  const handoff = (key: string, body: unknown, who: Client = maya) =>
    who.call('POST', `/api/tickets/${key}/handoff`, body);
  const rows = (table: string, key: string) =>
    ctx.db.raw.prepare(`SELECT * FROM ${table} WHERE ticket_key = ?`).all(key);

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-handoff-'));
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
    admin = await new Client(app).login(ADMIN);
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
    tunde = await new Client(app).login('tunde@x.test');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => {
    const seen: string[] = [];
    events = seen;
    unsubscribe = ctx.events.subscribe((chunk) => seen.push(chunk));
  });
  afterEach(() => unsubscribe());

  describe('moving the ticket', () => {
    it('approves to the next status by default, sets the assignee and posts a handoff comment', async () => {
      const t = await newTicket('des', 'Design');
      const res = await handoff(t.key, {
        decision: 'approve',
        assignee: 'sam@x.test',
        note: 'Ready for build, see the spec.',
      });
      expect(res.status).toBe(200);
      const body = HandoffResultSchema.parse(res.json);
      expect(body.ticket.status).toBe('Review');
      expect(body.ticket.assignee).toBe('sam@x.test');
      expect(body.comment).toMatchObject({ source: 'handoff', author: 'Maya Okafor' });
      expect(body.comment.body).toContain('Design to Review');
      expect(body.comment.body).toContain('Ready for build, see the spec.');
      expect(body.comment.body).toContain('Sam Adeyemi');
      expect(body.handoff).toMatchObject({
        decision: 'approve',
        from_status: 'Design',
        to_status: 'Review',
        to_assignee: 'sam@x.test',
      });

      const stored = TicketSchema.parse((await maya.call('GET', `/api/tickets/${t.key}`)).json);
      expect(stored.status).toBe('Review');
      const comments = (await maya.call('GET', `/api/tickets/${t.key}/comments`)).json as unknown[];
      expect(comments.map((c) => CommentSchema.parse(c).source)).toEqual(['handoff']);
    });

    it('announces the move, the comment and the handoff on the event stream', async () => {
      const t = await newTicket('des', 'Design');
      events.length = 0;
      await handoff(t.key, { decision: 'approve', assignee: 'sam@x.test' });
      const names = events.map((e) => /^event: (\S+)/.exec(e)?.[1]);
      expect(names).toEqual(['ticket.updated', 'comment.created', 'handoff.created']);
      const handoffEvent = events.find((e) => e.startsWith('event: handoff.created'))!;
      expect(handoffEvent).toContain('"to_assignee":"sam@x.test"');
      // The stream reaches every signed-in user, so it carries no note or reason.
      expect(handoffEvent).not.toContain('note');
    });

    it('lets approve pick any later status, and leaves the assignee alone when none is chosen', async () => {
      const t = await newTicket('des', 'Backlog');
      const res = await handoff(t.key, { decision: 'approve', to_status: 'Done' });
      expect(res.status).toBe(200);
      expect(res.json.ticket).toMatchObject({ status: 'Done', assignee: null });
    });

    it('rejects back to the previous status with a reason, or to a chosen earlier one', async () => {
      const t = await newTicket('des', 'Review');
      const first = await handoff(t.key, { decision: 'reject', reason: 'Wrong icon set' });
      expect(first.status).toBe(200);
      expect(first.json.ticket.status).toBe('Design');
      expect(first.json.comment.body).toContain('Wrong icon set');
      expect(first.json.handoff.decision).toBe('reject');

      await handoff(t.key, { decision: 'approve', to_status: 'Done' });
      const second = await handoff(t.key, {
        decision: 'reject',
        reason: 'Start over',
        to_status: 'Backlog',
      });
      expect(second.json.ticket.status).toBe('Backlog');
    });

    it('requires a reason to reject, and changes nothing without one', async () => {
      const t = await newTicket('des', 'Review');
      for (const reason of [undefined, '', '   ']) {
        const res = await handoff(t.key, { decision: 'reject', reason });
        expect(res.status).toBe(400);
        expect(res.json.error).toMatch(/reason is required/);
      }
      expect((await maya.call('GET', `/api/tickets/${t.key}`)).json.status).toBe('Review');
      expect(rows('ticket_handoffs', t.key)).toHaveLength(0);
      expect(rows('comments', t.key)).toHaveLength(0);
    });

    it('keeps the waterfall no-skipping rule, atomically', async () => {
      const t = await newTicket('eng', 'Requirements');
      const res = await handoff(t.key, { decision: 'approve', to_status: 'Implementation' });
      expect(res.status).toBe(409);
      expect(res.json.error).toMatch(/sequential only/);
      expect((await admin.call('GET', `/api/tickets/${t.key}`)).json.status).toBe('Requirements');
      expect(rows('ticket_handoffs', t.key)).toHaveLength(0);
      // One step is fine on the same board, and so is going back.
      expect((await handoff(t.key, { decision: 'approve' })).json.ticket.status).toBe('Design');
      const back = await handoff(t.key, { decision: 'reject', reason: 'Missed a requirement' });
      expect(back.json.ticket.status).toBe('Requirements');
    });

    it('refuses a wrong direction, an unknown status, an unknown decision and a dead end', async () => {
      const t = await newTicket('des', 'Review');
      const bad = async (body: Record<string, unknown>, status: number, message: RegExp) => {
        const res = await handoff(t.key, body);
        expect(res.status).toBe(status);
        expect(res.json.error).toMatch(message);
      };
      await bad({ decision: 'approve', to_status: 'Design' }, 400, /later status/);
      await bad({ decision: 'reject', reason: 'x', to_status: 'Done' }, 400, /earlier status/);
      await bad({ decision: 'approve', to_status: 'Nope' }, 400, /to_status must be one of/);
      await bad({ decision: 'maybe' }, 400, /approve or reject/);
      await bad({ decision: 'approve', note: 5 }, 400, /invalid note/);
      await bad({ decision: 'approve', note: 'x'.repeat(2001) }, 400, /note must be/);
      const done = await newTicket('des', 'Done');
      expect((await handoff(done.key, { decision: 'approve' })).status).toBe(409);
      const first = await newTicket('des', 'Backlog');
      expect((await handoff(first.key, { decision: 'reject', reason: 'x' })).status).toBe(409);
    });

    it('refuses when the ticket moved since the modal opened', async () => {
      const t = await newTicket('des', 'Design');
      await admin.call('PATCH', `/api/tickets/${t.key}`, { status: 'Review' });
      const res = await handoff(t.key, { decision: 'approve', from_status: 'Design' });
      expect(res.status).toBe(409);
      expect(res.json.error).toMatch(/moved/);
      expect((await admin.call('GET', `/api/tickets/${t.key}`)).json.status).toBe('Review');
    });

    it('rejects an unknown assignee or department, and changes nothing', async () => {
      const t = await newTicket('des', 'Design');
      const user = await handoff(t.key, { decision: 'approve', assignee: 'ghost@x.test' });
      expect(user.status).toBe(400);
      expect(user.json.error).toMatch(/existing user/);
      const dept = await handoff(t.key, { decision: 'approve', department: 'Piracy' });
      expect(dept.status).toBe(400);
      expect(dept.json.error).toMatch(/unknown department/);
      expect((await admin.call('GET', `/api/tickets/${t.key}`)).json).toMatchObject({
        status: 'Design',
        assignee: null,
      });
      expect(rows('ticket_handoffs', t.key)).toHaveLength(0);
    });

    it('needs a session, and a ticket that exists', async () => {
      const t = await newTicket();
      const anon = new Client(app);
      expect((await handoff(t.key, { decision: 'approve' }, anon)).status).toBe(401);
      expect((await handoff('FOOD-DES-9999', { decision: 'approve' })).status).toBe(404);
      expect((await maya.call('GET', '/api/handoffs/unread')).status).toBe(200);
      expect((await anon.call('GET', '/api/handoffs/unread')).status).toBe(401);
      expect((await anon.call('GET', '/api/people')).status).toBe(401);
    });

    it('lets anyone who can edit tickets do it (there is no per-ticket permission in v1)', async () => {
      const t = await newTicket('des', 'Design');
      expect((await handoff(t.key, { decision: 'approve' }, sam)).status).toBe(200);
    });
  });

  describe('attachments', () => {
    const upload = async (key: string, name: string) => {
      const form = new FormData();
      form.append('file', new File(['png-bytes'], name, { type: 'image/png' }));
      const res = await maya.call('POST', `/api/tickets/${key}/files`, form);
      expect(res.status).toBe(201);
      return res.json.id as string;
    };

    it('names the ticket files it was given in the comment', async () => {
      const t = await newTicket('des', 'Design');
      const id = await upload(t.key, 'mockup.png');
      const res = await handoff(t.key, { decision: 'approve', attachment_ids: [id] });
      expect(res.status).toBe(200);
      expect(res.json.comment.body).toContain('Attached: mockup.png');
    });

    it('refuses a file that belongs to another ticket or does not exist', async () => {
      const t = await newTicket('des', 'Design');
      const other = await newTicket('des', 'Design');
      const foreign = await upload(other.key, 'other.png');
      for (const ids of [[foreign], ['nope']]) {
        const res = await handoff(t.key, { decision: 'approve', attachment_ids: ids });
        expect(res.status).toBe(400);
        expect(res.json.error).toMatch(/attachment/);
      }
      expect((await admin.call('GET', `/api/tickets/${t.key}`)).json.status).toBe('Design');
    });
  });

  describe('nudging the recipient', () => {
    const unread = async (who: Client) => {
      const res = await who.call('GET', '/api/handoffs/unread');
      expect(res.status).toBe(200);
      return HandoffNoticeListSchema.parse(res.json);
    };

    it('lists a handoff to a person for that person only, until they read it', async () => {
      const t = await newTicket('des', 'Design');
      await handoff(t.key, {
        decision: 'approve',
        assignee: 'sam@x.test',
        note: 'Over to you',
      });
      const mine = (await unread(sam)).filter((n) => n.ticket_key === t.key);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        ticket_title: 'Logo refresh',
        from_name: 'Maya Okafor',
        from_status: 'Design',
        to_status: 'Review',
        note: 'Over to you',
        decision: 'approve',
      });
      expect((await unread(tunde)).filter((n) => n.ticket_key === t.key)).toHaveLength(0);
      expect((await unread(maya)).filter((n) => n.ticket_key === t.key)).toHaveLength(0);

      const read = await sam.call('POST', `/api/tickets/${t.key}/handoffs/read`, {});
      expect(read.status).toBe(200);
      expect((await unread(sam)).filter((n) => n.ticket_key === t.key)).toHaveLength(0);
    });

    it('reaches every member of a department when only a department is chosen', async () => {
      const t = await newTicket('des', 'Design');
      const res = await handoff(t.key, { decision: 'approve', department: 'Engineering' });
      expect(res.json.ticket.assignee).toBeNull();
      expect(res.json.handoff.to_department).toBe('Engineering');
      expect((await unread(sam)).some((n) => n.ticket_key === t.key)).toBe(true);
      expect((await unread(tunde)).some((n) => n.ticket_key === t.key)).toBe(true);
      expect((await unread(maya)).some((n) => n.ticket_key === t.key)).toBe(false);
      // One person reading it does not clear it for the other.
      await sam.call('POST', `/api/tickets/${t.key}/handoffs/read`, {});
      expect((await unread(sam)).some((n) => n.ticket_key === t.key)).toBe(false);
      expect((await unread(tunde)).some((n) => n.ticket_key === t.key)).toBe(true);
    });

    it('does not nudge you about your own handoff, nor a department when a person was chosen', async () => {
      const t = await newTicket('des', 'Design');
      await handoff(t.key, { decision: 'approve', assignee: 'maya@x.test' }, maya);
      expect((await unread(maya)).some((n) => n.ticket_key === t.key)).toBe(false);
      const u = await newTicket('des', 'Design');
      await handoff(u.key, {
        decision: 'approve',
        assignee: 'sam@x.test',
        department: 'Engineering',
      });
      expect((await unread(tunde)).some((n) => n.ticket_key === u.key)).toBe(false);
    });

    it('goes away with the ticket', async () => {
      const t = await newTicket('des', 'Design');
      await handoff(t.key, { decision: 'approve', assignee: 'sam@x.test' });
      await sam.call('POST', `/api/tickets/${t.key}/handoffs/read`, {});
      await admin.call('DELETE', `/api/tickets/${t.key}`);
      expect(rows('ticket_handoffs', t.key)).toHaveLength(0);
      expect((await unread(sam)).some((n) => n.ticket_key === t.key)).toBe(false);
      const stranded = ctx.db.raw
        .prepare(
          'SELECT COUNT(*) AS n FROM handoff_reads WHERE handoff_id NOT IN (SELECT id FROM ticket_handoffs)',
        )
        .get() as { n: number };
      expect(stranded.n).toBe(0);
    });
  });

  describe('departments', () => {
    it('lists people with their department to any signed-in user', async () => {
      const res = await sam.call('GET', '/api/people');
      expect(res.status).toBe(200);
      const people = PersonListSchema.parse(res.json);
      expect(people.find((p) => p.email === 'maya@x.test')).toEqual({
        email: 'maya@x.test',
        name: 'Maya Okafor',
        department: 'Design',
      });
      expect(people.find((p) => p.email === ADMIN)?.department).toBeNull();
      expect(JSON.stringify(people)).not.toContain('password');
    });

    it('lets only an admin set or clear a department, and validates it', async () => {
      const users = (await admin.call('GET', '/api/users')).json as Array<{
        id: number;
        email: string;
        department?: string | null;
      }>;
      const tundeRow = users.find((u) => u.email === 'tunde@x.test')!;
      expect(tundeRow.department).toBe('Engineering');
      const url = `/api/users/${tundeRow.id}/department`;

      expect((await sam.call('PATCH', url, { department: 'QA' })).status).toBe(403);
      expect((await new Client(app).call('PATCH', url, { department: 'QA' })).status).toBe(401);
      for (const department of ['', 'x'.repeat(41), 'a\nb', 7, undefined]) {
        expect((await admin.call('PATCH', url, { department })).status).toBe(400);
      }
      expect(
        (await admin.call('PATCH', '/api/users/99999/department', { department: 'QA' })).status,
      ).toBe(404);

      const set = await admin.call('PATCH', url, { department: '  QA  ' });
      expect(set.status).toBe(200);
      expect(set.json).toEqual({ id: tundeRow.id, department: 'QA' });
      const cleared = await admin.call('PATCH', url, { department: null });
      expect(cleared.json.department).toBeNull();
      await admin.call('PATCH', url, { department: 'Engineering' });
    });

    it('refuses a department that is too long when an admin creates a user', async () => {
      const res = await admin.call('POST', '/api/users', {
        email: 'long@x.test',
        name: 'Long',
        password: PASSWORD,
        department: 'x'.repeat(41),
      });
      expect(res.status).toBe(400);
    });
  });
});
