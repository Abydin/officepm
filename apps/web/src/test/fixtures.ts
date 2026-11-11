import type { Board, Project, Ticket } from '@officepm/shared';
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
  'GET /api/users': [
    { id: 1, email: demoUser.email, name: 'Maya Okafor', is_admin: 1, created_at: '' },
    { id: 2, email: 'sam@officepm.demo', name: 'Sam Adeyemi', is_admin: 0, created_at: '' },
  ],
};

/** The ticket routes a drawer needs for one ticket, backed by a mutable record. */
export function ticketRoutes(ticket: { current: Ticket }) {
  return {
    [`GET /api/tickets/${ticket.current.key}`]: () => jsonResponse(ticket.current),
    [`GET /api/tickets/${ticket.current.key}/comments`]: [],
    [`GET /api/tickets/${ticket.current.key}/links`]: [],
    [`GET /api/tickets/${ticket.current.key}/files`]: [],
  };
}
