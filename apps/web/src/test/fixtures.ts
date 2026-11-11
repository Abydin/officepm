import type { Board, Doc, Project, ProjectFile, Retro, Sprint, Ticket } from '@officepm/shared';
import { demoUser, jsonResponse } from './helpers';

export const designBoard: Board = {
  slug: 'design',
  name: 'Design',
  prefix: 'FOOD-DES',
  icon: 'pen-tool',
  flow: 'kanban',
  statuses: ['Backlog', 'In Progress', 'Review', 'Done'],
  types: ['task', 'asset'],
  points: false,
  has_github: false,
  agile: false,
  wip_limits: { 'In Progress': 3 },
  done_statuses: ['Done'],
};

export const foodProject: Project = {
  slug: 'food',
  name: 'Food',
  description: 'Office food ordering',
  boards: [designBoard],
};

export function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    project_slug: 'food',
    board_slug: 'design',
    key: 'FOOD-DES-1',
    title: 'Logo refresh',
    type: 'task',
    status: 'Backlog',
    assignee: null,
    qa_owner: null,
    parent_key: null,
    level: null,
    description: null,
    acceptance_criteria: [],
    points: null,
    appetite: null,
    sprint_id: null,
    blocked: false,
    blocker_reason: null,
    priority: null,
    labels: [],
    due_date: null,
    created_at: '2026-10-01 09:00:00',
    updated_at: '2026-10-02 09:00:00',
    ...over,
  };
}

/** The routes every signed-in screen needs, to spread into a stubApi table. */
export const signedIn = {
  'GET /api/me': demoUser,
  'GET /api/projects': [foodProject],
  'GET /api/projects/food/boards/design': designBoard,
  'GET /api/dashboard': () => jsonResponse({}),
  'GET /api/handoffs/unread': [],
  'GET /api/people': [
    { id: 1, name: 'Maya Okafor', department: 'Design' },
    { id: 2, name: 'Sam Adeyemi', department: 'Engineering' },
  ],
  'GET /api/users': [
    { id: 1, email: demoUser.email, name: 'Maya Okafor', is_admin: 1, created_at: '' },
    { id: 2, email: 'sam@officepm.demo', name: 'Sam Adeyemi', is_admin: 0, created_at: '' },
  ],
};

/** What POST /api/tickets/:key/handoff answers with, for a ticket now in `status`. */
export function handoffResult(ticket: Ticket, status: string) {
  return {
    ticket: { ...ticket, status },
    comment: {
      id: 1,
      ticket_key: ticket.key,
      author: 'Maya Okafor',
      body: `Handed off from ${ticket.status} to ${status}.`,
      source: 'handoff',
      created_at: '2026-10-03 10:00:00',
    },
    handoff: {
      id: 'h1',
      decision: 'approve',
      from_status: ticket.status,
      to_status: status,
      to_user_id: null,
      to_department: null,
    },
  };
}

/** The ticket routes a drawer needs for one ticket, backed by a mutable record. */
export function ticketRoutes(ticket: { current: Ticket }) {
  return {
    [`GET /api/tickets/${ticket.current.key}`]: () => jsonResponse(ticket.current),
    [`GET /api/tickets/${ticket.current.key}/comments`]: [],
    [`GET /api/tickets/${ticket.current.key}/links`]: [],
    [`GET /api/tickets/${ticket.current.key}/files`]: [],
  };
}

export const engBoard: Board = {
  slug: 'eng',
  name: 'Engineering',
  prefix: 'FOOD-ENG',
  icon: 'code',
  flow: 'scrum',
  statuses: ['Backlog', 'Sprint Backlog', 'In Progress', 'Done'],
  types: ['epic', 'story', 'task', 'bug'],
  points: true,
  has_github: false,
  agile: true,
  wip_limits: {},
  done_statuses: ['Done'],
};

export function makeSprint(over: Partial<Sprint> = {}): Sprint {
  return {
    id: 's14',
    project_slug: 'food',
    board_slug: 'eng',
    name: 'Sprint 14',
    kind: 'sprint',
    start_date: '2026-10-01',
    end_date: '2026-10-15',
    status: 'planned',
    created_at: '2026-10-01 09:00:00',
    ...over,
  };
}

export function makeRetro(over: Partial<Retro> = {}): Retro {
  return {
    id: 'r1',
    project_slug: 'food',
    board_slug: 'eng',
    sprint_id: 's13',
    name: 'Retro: Sprint 13',
    status: 'open',
    created_at: '2026-10-10 09:00:00',
    ...over,
  };
}

/** Routes for a scrum board that has sprints, spread into a stubApi table. */
export function engRoutes(extra: Record<string, unknown> = {}) {
  return {
    ...signedIn,
    'GET /api/projects': [{ ...foodProject, boards: [designBoard, engBoard] }],
    'GET /api/projects/food/boards/eng': engBoard,
    'GET /api/projects/food/boards/eng/settings': {
      flow: 'scrum',
      agile_enabled: true,
      wip_limits: {},
      definition_of_done: [],
      definition_of_ready: ['Acceptance criteria written', 'Estimated by the team'],
    },
    ...extra,
  };
}

export const doc = (over: Partial<Doc> = {}): Doc => ({
  id: 'd1',
  project_slug: 'food',
  title: 'Ordering API reference',
  kind: 'link',
  url: 'https://example.com/docs/ordering-api',
  body: 'Endpoints, auth and error codes.',
  author: 'Tunde Bakare',
  created_at: '2026-10-01 09:00:00',
  ...over,
});

export const projectFile = (over: Partial<ProjectFile> = {}): ProjectFile => ({
  id: 'f1',
  project_slug: 'food',
  original_name: 'menu.pdf',
  size_bytes: 20480,
  mime_type: 'application/pdf',
  uploaded_by: 'Maya Okafor',
  created_at: '2026-10-01 09:00:00',
  ...over,
});
