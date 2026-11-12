// The feature pipeline: per-project phases, moving an epic along them, and the gate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EpicPipelineSchema,
  PipelineConfigSchema,
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
      slug: 'plain',
      name: 'Plain',
      boards: [
        {
          slug: 'eng',
          name: 'Engineering',
          prefix: 'PLAIN-ENG',
          flow: 'kanban',
          statuses: ['Backlog', 'In Progress', 'Done'],
          types: ['epic', 'task'],
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

describe('pipeline', () => {
  let dir: string;
  let ctx: AppContext;
  let app: ReturnType<typeof createApp>;
  let admin: Client;
  let maya: Client;
  let sam: Client;
  const id = { maya: 0, sam: 0 };

  const newEpic = async (over: Record<string, unknown> = {}): Promise<Ticket> => {
    const res = await admin.call('POST', '/api/tickets', {
      project_slug: 'food',
      board_slug: 'eng',
      title: 'Loyalty points',
      type: 'epic',
      ...over,
    });
    expect(res.status).toBe(201);
    return TicketSchema.parse(res.json);
  };
  const newChild = async (epic: string, over: Record<string, unknown> = {}): Promise<Ticket> => {
    const res = await admin.call('POST', '/api/tickets', {
      project_slug: 'food',
      board_slug: 'eng',
      title: 'Child',
      type: 'task',
      parent_key: epic,
      ...over,
    });
    expect(res.status).toBe(201);
    return TicketSchema.parse(res.json);
  };
  const setPhases = (phases: unknown[], who: Client = admin, slug = 'food') =>
    who.call('PUT', `/api/projects/${slug}/pipeline`, { phases });
  const pipelineOf = async (key: string) =>
    EpicPipelineSchema.parse((await admin.call('GET', `/api/tickets/${key}/pipeline`)).json);
  const handoff = (key: string, body: Record<string, unknown>, who: Client = maya) =>
    who.call('POST', `/api/tickets/${key}/handoff`, body);
  const start = (key: string) => admin.call('POST', `/api/tickets/${key}/pipeline/start`);
  const phaseNames = async (slug = 'food') =>
    PipelineConfigSchema.parse(
      (await admin.call('GET', `/api/projects/${slug}/pipeline`)).json,
    ).phases.map((p) => p.name);

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-pipeline-'));
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
    id.maya = people.find((p) => p.name === 'Maya Okafor')!.id;
    id.sam = people.find((p) => p.name === 'Sam Adeyemi')!.id;
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Every test starts from no tickets, no handoffs and no stored phase lists.
  beforeEach(() => {
    for (const table of [
      'tickets',
      'comments',
      'ticket_handoffs',
      'handoff_recipients',
      'handoff_reads',
      'ticket_participants',
      'project_phases',
    ]) {
      ctx.db.raw.prepare(`DELETE FROM ${table}`).run();
    }
  });

  describe('the project phase list', () => {
    it('serves the built-in default, unconfigured and without storing anything', async () => {
      const res = await maya.call('GET', '/api/projects/acme/pipeline');
      expect(res.status).toBe(200);
      const cfg = PipelineConfigSchema.parse(res.json);
      expect(cfg.configured).toBe(false);
      expect(cfg.phases.map((p) => p.name)).toEqual([
        'Product',
        'Design',
        'Engineering',
        'QA',
        'Release',
      ]);
      expect(ctx.db.raw.prepare('SELECT count(*) AS n FROM project_phases').get()).toEqual({
        n: 0,
      });
      expect((await maya.call('GET', '/api/projects/nope/pipeline')).status).toBe(404);
    });

    it('lets only an admin change it', async () => {
      const res = await setPhases([{ name: 'Only' }], maya);
      expect(res.status).toBe(403);
      expect(await phaseNames('acme')).toHaveLength(5);
    });

    it.each([
      ['an empty list', [], /at least one/],
      ['a blank name', [{ name: '  ' }], /name/],
      ['a multi-line name', [{ name: 'A\nB' }], /single line/],
      ['a bidi name', [{ name: 'A‮b' }], /single line/],
      ['a too-long name', [{ name: 'x'.repeat(41) }], /name/],
      ['duplicate names ignoring case', [{ name: 'QA' }, { name: 'qa' }], /different/],
      ['a bad department', [{ name: 'QA', department: 'a\nb' }], /department/],
      ['an unknown rename source', [{ name: 'QA', was: 'Ghost' }], /unknown phase/],
      ['13 phases', Array.from({ length: 13 }, (_, i) => ({ name: 'P' + i })), /too big|at most/i],
    ])('refuses %s', async (_name, phases, message) => {
      const res = await setPhases(phases, admin, 'acme');
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(message);
      expect((await admin.call('GET', '/api/projects/acme/pipeline')).json.configured).toBe(false);
    });

    it('stores an edited list in order with its departments, and trims names', async () => {
      const res = await setPhases(
        [
          { name: ' Discovery ', department: 'Product' },
          { name: 'Build', department: 'Engineering' },
          { name: 'Ship' },
        ],
        admin,
        'acme',
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual({
        configured: true,
        phases: [
          { name: 'Discovery', department: 'Product' },
          { name: 'Build', department: 'Engineering' },
          { name: 'Ship', department: null },
        ],
      });
      // Reordering is the same call.
      const again = await setPhases(
        [{ name: 'Ship' }, { name: 'Discovery', department: 'Product' }],
        admin,
        'acme',
      );
      expect(again.json.phases.map((p: { name: string }) => p.name)).toEqual(['Ship', 'Discovery']);
    });

    it('keeps tickets on a renamed phase, even when two names swap', async () => {
      await setPhases([{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }]);
      const epic = await newEpic();
      const a = await newChild(epic.key, { phase: 'Alpha' });
      const b = await newChild(epic.key, { phase: 'Beta' });
      const res = await setPhases([
        { name: 'Beta', was: 'Alpha' },
        { name: 'Alpha', was: 'Beta' },
        { name: 'Gamma' },
      ]);
      expect(res.status).toBe(200);
      const row = (key: string) =>
        admin.call('GET', `/api/tickets/${key}`).then((r) => r.json.phase);
      expect(await row(a.key)).toBe('Beta');
      expect(await row(b.key)).toBe('Alpha');
    });

    it('refuses to remove a phase a ticket uses, naming how many, and removes an unused one', async () => {
      await setPhases([{ name: 'One' }, { name: 'Two' }, { name: 'Three' }]);
      const epic = await newEpic();
      await newChild(epic.key, { phase: 'Two' });
      await newChild(epic.key, { phase: 'Two' });
      const refused = await setPhases([{ name: 'One' }, { name: 'Three' }]);
      expect(refused.status).toBe(409);
      expect(refused.json.error).toMatch(/"Two" is still used by 2 tickets/);
      expect(await phaseNames()).toEqual(['One', 'Two', 'Three']);
      const ok = await setPhases([{ name: 'One' }, { name: 'Two' }]);
      expect(ok.status).toBe(200);
      expect(await phaseNames()).toEqual(['One', 'Two']);
    });

    it('counts an epic that is in the phase as using it', async () => {
      await setPhases([{ name: 'One' }, { name: 'Two' }]);
      const epic = await newEpic();
      expect(epic.phase).toBe('One');
      const refused = await setPhases([{ name: 'Two' }]);
      expect(refused.status).toBe(409);
    });
  });

  describe('an epic and its pipeline', () => {
    beforeEach(async () => {
      await setPhases([
        { name: 'Product', department: 'Product' },
        { name: 'Design', department: 'Design' },
        { name: 'Engineering', department: 'Engineering' },
        { name: 'QA' },
        { name: 'Release' },
      ]);
    });

    it('starts a new epic at the first phase on a project with a configured pipeline', async () => {
      const epic = await newEpic();
      expect(epic.phase).toBe('Product');
      const p = await pipelineOf(epic.key);
      expect(p).toMatchObject({ in_use: true, current: 'Product', completed: false, history: [] });
    });

    it('leaves an epic on an unconfigured project with no phase, and its handoff stays on statuses', async () => {
      const res = await admin.call('POST', '/api/tickets', {
        project_slug: 'acme',
        board_slug: 'eng',
        title: 'Plain epic',
        type: 'task',
      });
      expect(res.status).toBe(201);
      // An epic on a board whose type list has no epic: use food's second project instead.
      const plain = await newEpic({ project_slug: 'plain', board_slug: 'eng' });
      expect(plain.phase ?? null).toBeNull();
      expect((await pipelineOf(plain.key)).in_use).toBe(false);
      const moved = await handoff(plain.key, { decision: 'approve' });
      expect(moved.status).toBe(200);
      expect(moved.json.ticket.status).toBe('In Progress');
      expect(moved.json.phase).toBeUndefined();
      expect(
        ctx.db.raw.prepare('SELECT kind FROM ticket_handoffs WHERE ticket_key = ?').get(plain.key),
      ).toEqual({ kind: null });
    });

    it('starts the pipeline on demand, once, at the first phase, writing nothing for the project', async () => {
      const plain = await newEpic({ project_slug: 'plain', board_slug: 'eng' });
      const before = ctx.db.raw
        .prepare('SELECT count(*) AS n FROM project_phases WHERE project_slug = ?')
        .get('plain');
      const res = await start(plain.key);
      expect(res.status).toBe(200);
      expect(EpicPipelineSchema.parse(res.json).current).toBe('Product');
      expect(
        ctx.db.raw
          .prepare('SELECT count(*) AS n FROM project_phases WHERE project_slug = ?')
          .get('plain'),
      ).toEqual(before);
      expect((await start(plain.key)).status).toBe(409);
    });

    it('refuses a pipeline on a ticket that is not an epic, and unknown tickets', async () => {
      const task = await newChild('NONE-1');
      expect((await admin.call('GET', `/api/tickets/${task.key}/pipeline`)).status).toBe(409);
      expect((await start(task.key)).status).toBe(409);
      expect((await admin.call('GET', '/api/tickets/NOPE-1/pipeline')).status).toBe(404);
    });

    it('moves forward one phase by default and records who, from, to and the people', async () => {
      const epic = await newEpic();
      const res = await handoff(epic.key, {
        decision: 'approve',
        assignee_id: id.maya,
        department: 'Design',
        note: 'Brief is attached to the doc',
        from_phase: 'Product',
      });
      expect(res.status).toBe(200);
      expect(res.json.phase).toEqual({ from: 'Product', to: 'Design', completed: false });
      expect(res.json.ticket.phase).toBe('Design');
      expect(res.json.ticket.status).toBe('Backlog');
      const p = await pipelineOf(epic.key);
      expect(p.current).toBe('Design');
      expect(p.history).toHaveLength(1);
      expect(p.history[0]).toMatchObject({
        decision: 'approve',
        from_phase: 'Product',
        to_phase: 'Design',
        completed: false,
        reason: null,
        note: 'Brief is attached to the doc',
        from_name: 'Maya Okafor',
        to_names: ['Maya Okafor'],
        to_department: 'Design',
      });
      expect(res.json.comment.body).toContain('Moved from Product to Design.');
    });

    it('can approve to any later phase, and refuses a later phase on reject and an earlier one on approve', async () => {
      const epic = await newEpic();
      expect((await handoff(epic.key, { decision: 'approve', to_phase: 'Product' })).status).toBe(
        400,
      );
      expect(
        (await handoff(epic.key, { decision: 'reject', to_phase: 'QA', reason: 'x' })).status,
      ).toBe(400);
      expect((await handoff(epic.key, { decision: 'approve', to_phase: 'Nowhere' })).status).toBe(
        400,
      );
      const res = await handoff(epic.key, { decision: 'approve', to_phase: 'Engineering' });
      expect(res.status).toBe(200);
      expect(res.json.ticket.phase).toBe('Engineering');
    });

    it('needs a reason to send a feature back, then goes back and forth', async () => {
      const epic = await newEpic();
      await handoff(epic.key, { decision: 'approve' });
      const noReason = await handoff(epic.key, { decision: 'reject' });
      expect(noReason.status).toBe(400);
      expect(noReason.json.error).toMatch(/reason is required/);
      expect((await handoff(epic.key, { decision: 'reject', reason: '   ' })).status).toBe(400);
      const back = await handoff(epic.key, { decision: 'reject', reason: 'Scope is unclear' });
      expect(back.status).toBe(200);
      expect(back.json.ticket.phase).toBe('Product');
      const again = await handoff(epic.key, { decision: 'approve' });
      expect(again.json.ticket.phase).toBe('Design');
      const p = await pipelineOf(epic.key);
      expect(p.history.map((h) => `${h.decision}:${h.from_phase}>${h.to_phase}`)).toEqual([
        'approve:Product>Design',
        'reject:Design>Product',
        'approve:Product>Design',
      ]);
      expect(p.history[1]!.reason).toBe('Scope is unclear');
      // The first phase has nowhere to go back to.
      const first = await newEpic();
      expect((await handoff(first.key, { decision: 'reject', reason: 'no' })).status).toBe(409);
    });

    it('refuses a stale dialog and leaves the epic where it was', async () => {
      const epic = await newEpic();
      await handoff(epic.key, { decision: 'approve' });
      const stale = await handoff(epic.key, { decision: 'approve', from_phase: 'Product' });
      expect(stale.status).toBe(409);
      expect(stale.json.error).toMatch(/moved to "Design"/);
      expect((await pipelineOf(epic.key)).current).toBe('Design');
    });

    it('is not undone or broken by a plain PATCH of other fields, and refuses PATCHing the phase of an epic', async () => {
      const epic = await newEpic();
      const ok = await admin.call('PATCH', `/api/tickets/${epic.key}`, { title: 'Loyalty v2' });
      expect(ok.status).toBe(200);
      expect(ok.json.phase).toBe('Product');
      const refused = await admin.call('PATCH', `/api/tickets/${epic.key}`, { phase: 'QA' });
      expect(refused.status).toBe(409);
      expect((await pipelineOf(epic.key)).current).toBe('Product');
    });
  });

  describe('tagging tickets under a feature', () => {
    beforeEach(async () => {
      await setPhases([
        { name: 'Product' },
        { name: 'Design' },
        { name: 'Engineering' },
        { name: 'QA' },
      ]);
    });

    it('takes a phase and a department on create and on PATCH, validated', async () => {
      const epic = await newEpic();
      const be = await newChild(epic.key, {
        title: 'Backend',
        phase: 'engineering',
        department: ' Backend ',
      });
      expect(be.phase).toBe('Engineering');
      expect(be.department).toBe('Backend');
      const patched = await admin.call('PATCH', `/api/tickets/${be.key}`, {
        phase: 'QA',
        department: null,
      });
      expect(patched.status).toBe(200);
      expect(patched.json).toMatchObject({ phase: 'QA', department: null });
      for (const bad of [
        { phase: 'Nope' },
        { department: 'a\nb' },
        { department: 'x'.repeat(41) },
        { phase: 7 },
      ]) {
        const res = await admin.call('PATCH', `/api/tickets/${be.key}`, bad);
        expect(res.status).toBe(400);
      }
      const badCreate = await admin.call('POST', '/api/tickets', {
        project_slug: 'food',
        board_slug: 'eng',
        title: 'x',
        type: 'task',
        phase: 'Nope',
      });
      expect(badCreate.status).toBe(400);
    });

    it('gives each ticket its own assignee and status under the same feature', async () => {
      const epic = await newEpic();
      const be = await newChild(epic.key, {
        title: 'Backend',
        phase: 'Engineering',
        department: 'Backend',
        assignee: 'sam@x.test',
      });
      const fe = await newChild(epic.key, {
        title: 'Frontend',
        phase: 'Engineering',
        department: 'Frontend',
        assignee: 'maya@x.test',
      });
      await admin.call('PATCH', `/api/tickets/${be.key}`, { status: 'In Progress' });
      expect(be.parent_key).toBe(epic.key);
      expect(fe.parent_key).toBe(epic.key);
      expect(be.key).not.toBe(fe.key);
      const fresh = (await admin.call('GET', `/api/tickets/${fe.key}`)).json;
      expect(fresh.status).toBe('Backlog');
      expect(fresh.assignee).toBe('maya@x.test');
    });
  });

  describe('the gate', () => {
    const toEngineering = async (epic: Ticket) => {
      await handoff(epic.key, { decision: 'approve', to_phase: 'Engineering' });
    };
    beforeEach(async () => {
      await setPhases([
        { name: 'Product' },
        { name: 'Design' },
        { name: 'Engineering' },
        { name: 'QA' },
      ]);
    });

    it('answers 409 when tagged tickets are open, and the epic does not move', async () => {
      const epic = await newEpic();
      await toEngineering(epic);
      await newChild(epic.key, { phase: 'Engineering', department: 'Backend' });
      await newChild(epic.key, { phase: 'Engineering', department: 'Frontend' });
      const res = await handoff(epic.key, { decision: 'approve', from_phase: 'Engineering' });
      expect(res.status).toBe(409);
      expect(res.json.error).toBe(
        '2 tickets in Engineering are still open: confirm to move on anyway',
      );
      expect((await pipelineOf(epic.key)).current).toBe('Engineering');
      // An explicit false is not a yes either.
      expect((await handoff(epic.key, { decision: 'approve', move_anyway: false })).status).toBe(
        409,
      );
    });

    it('moves with move_anyway and records it in the comment', async () => {
      const epic = await newEpic();
      await toEngineering(epic);
      await newChild(epic.key, { phase: 'Engineering' });
      const res = await handoff(epic.key, { decision: 'approve', move_anyway: true });
      expect(res.status).toBe(200);
      expect(res.json.ticket.phase).toBe('QA');
      expect(res.json.comment.body).toContain('Moved on with 1 open ticket in Engineering.');
    });

    it('does not count finished tickets, other phases, untagged tickets or sub-tickets', async () => {
      const epic = await newEpic();
      await toEngineering(epic);
      const done = await newChild(epic.key, { phase: 'Engineering' });
      await admin.call('PATCH', `/api/tickets/${done.key}`, { status: 'Done' });
      await newChild(epic.key, { phase: 'QA' });
      await newChild(epic.key);
      const sub = await admin.call('POST', `/api/tickets/${done.key}/subtickets`, { title: 'Sub' });
      expect(sub.status).toBe(201);
      const res = await handoff(epic.key, { decision: 'approve' });
      expect(res.status).toBe(200);
      expect(res.json.ticket.phase).toBe('QA');
    });

    it('does not gate sending a feature back', async () => {
      const epic = await newEpic();
      await toEngineering(epic);
      await newChild(epic.key, { phase: 'Engineering' });
      const res = await handoff(epic.key, { decision: 'reject', reason: 'Design changed' });
      expect(res.status).toBe(200);
      expect(res.json.ticket.phase).toBe('Design');
    });

    it('shows per-phase done and total counts on the pipeline', async () => {
      const epic = await newEpic();
      const a = await newChild(epic.key, { phase: 'Engineering' });
      await newChild(epic.key, { phase: 'Engineering' });
      await admin.call('PATCH', `/api/tickets/${a.key}`, { status: 'Done' });
      const p = await pipelineOf(epic.key);
      expect(p.phases.find((x) => x.name === 'Engineering')).toMatchObject({ done: 1, total: 2 });
      expect(p.phases.find((x) => x.name === 'QA')).toMatchObject({ done: 0, total: 0 });
    });
  });

  describe('finishing a feature', () => {
    beforeEach(async () => {
      await setPhases([{ name: 'Product' }, { name: 'Release' }]);
    });

    it('completes from the last phase: the epic keeps the phase and takes the first done status', async () => {
      const epic = await newEpic();
      await handoff(epic.key, { decision: 'approve' });
      const res = await handoff(epic.key, { decision: 'approve', note: 'Shipped' });
      expect(res.status).toBe(200);
      expect(res.json.phase).toEqual({ from: 'Release', to: null, completed: true });
      expect(res.json.ticket).toMatchObject({ phase: 'Release', status: 'Done' });
      const p = await pipelineOf(epic.key);
      expect(p.completed).toBe(true);
      expect(p.history.at(-1)).toMatchObject({
        from_phase: 'Release',
        to_phase: null,
        completed: true,
      });
      expect((await handoff(epic.key, { decision: 'approve' })).status).toBe(409);
    });

    it('reopens a completed feature when it is sent back', async () => {
      const epic = await newEpic();
      await handoff(epic.key, { decision: 'approve' });
      await handoff(epic.key, { decision: 'approve' });
      const res = await handoff(epic.key, { decision: 'reject', reason: 'Found a bug in prod' });
      expect(res.status).toBe(200);
      expect(res.json.ticket).toMatchObject({ phase: 'Product', status: 'Backlog' });
      expect((await pipelineOf(epic.key)).completed).toBe(false);
    });

    it('is not complete when someone reopens the epic through PATCH', async () => {
      const epic = await newEpic();
      await handoff(epic.key, { decision: 'approve' });
      await handoff(epic.key, { decision: 'approve' });
      await admin.call('PATCH', `/api/tickets/${epic.key}`, { status: 'In Progress' });
      expect((await pipelineOf(epic.key)).completed).toBe(false);
    });

    it('gates completion on the last phase too', async () => {
      const epic = await newEpic();
      await handoff(epic.key, { decision: 'approve' });
      await newChild(epic.key, { phase: 'Release' });
      expect((await handoff(epic.key, { decision: 'approve' })).status).toBe(409);
      expect((await handoff(epic.key, { decision: 'approve', move_anyway: true })).status).toBe(
        200,
      );
    });
  });

  describe('notifications and privacy', () => {
    beforeEach(async () => {
      await setPhases([{ name: 'Product' }, { name: 'Design' }, { name: 'QA' }]);
    });

    it('nudges the people chosen, through the same unread list as a status handoff', async () => {
      const epic = await newEpic();
      const res = await handoff(epic.key, {
        decision: 'approve',
        assignee_id: id.sam,
        participant_ids: [id.maya],
      });
      expect(res.status).toBe(200);
      const unread = (await sam.call('GET', '/api/handoffs/unread')).json as Array<{
        ticket_key: string;
        from_status: string;
        to_status: string;
      }>;
      expect(unread.find((n) => n.ticket_key === epic.key)).toMatchObject({
        from_status: 'Product',
        to_status: 'Design',
      });
      expect((await pipelineOf(epic.key)).history[0]!.to_names.sort()).toEqual([
        'Maya Okafor',
        'Sam Adeyemi',
      ]);
    });

    it('never puts an email in a pipeline response', async () => {
      const epic = await newEpic();
      await handoff(
        epic.key,
        {
          decision: 'approve',
          assignee_id: id.sam,
          participant_ids: [id.maya],
          note: 'Over to you',
        },
        sam,
      );
      const bodies = [
        (await admin.call('GET', '/api/projects/food/pipeline')).text,
        (await setPhases([{ name: 'Product' }, { name: 'Design' }, { name: 'QA' }])).text,
        (await admin.call('GET', `/api/tickets/${epic.key}/pipeline`)).text,
        (await start('NONE-1')).text,
      ];
      for (const text of bodies) expect(text).not.toMatch(/@|x\.test|officepm\.local/);
    });
  });

  it('survives a ticket being deleted: its history goes with it', async () => {
    await setPhases([{ name: 'Product' }, { name: 'Design' }]);
    const epic = await newEpic();
    await handoff(epic.key, { decision: 'approve' });
    const res = await admin.call('DELETE', `/api/tickets/${epic.key}`);
    expect(res.status).toBe(200);
    expect(
      ctx.db.raw
        .prepare('SELECT count(*) AS n FROM ticket_handoffs WHERE ticket_key = ?')
        .get(epic.key),
    ).toEqual({ n: 0 });
  });
});
