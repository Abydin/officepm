// Response shapes for endpoints that return a bare array, plus the server-sent
// event names. The web client validates every response against these.
import { z } from 'zod';
import { ProjectSchema, SprintSchema, TicketSchema } from './entities.js';

/** GET /api/projects. */
export const ProjectListSchema = z.array(ProjectSchema);
export type ProjectList = z.infer<typeof ProjectListSchema>;

/** GET /api/tickets and GET /api/my-tickets. */
export const TicketListSchema = z.array(TicketSchema);
export type TicketList = z.infer<typeof TicketListSchema>;

/** GET /api/projects/:slug/boards/:board/sprints. */
export const SprintListSchema = z.array(SprintSchema);
export type SprintList = z.infer<typeof SprintListSchema>;

/**
 * Names the server broadcasts on GET /api/events. Each arrives as a named SSE
 * event, so a client must register a listener per name: `onmessage` never fires.
 */
export const SERVER_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.deleted',
  'comment.created',
  'sprint.created',
  'sprint.updated',
  'sprint.deleted',
  'retro.card.created',
] as const;
export const ServerEventNameSchema = z.enum(SERVER_EVENTS);
export type ServerEventName = z.infer<typeof ServerEventNameSchema>;
