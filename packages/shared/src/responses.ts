// Response shapes for endpoints that return a bare array, plus the server-sent
// event names. The web client validates every response against these.
import { z } from 'zod';
import {
  CommentSchema,
  DocSchema,
  DodItemSchema,
  GithubLinkSchema,
  HandoffNoticeSchema,
  PersonSchema,
  ProjectFileSchema,
  ProjectSchema,
  RetroSchema,
  SprintSchema,
  TicketFileSchema,
  TicketLinkSchema,
  TicketSchema,
  UserListItemSchema,
} from './entities.js';

/** GET /api/projects. */
export const ProjectListSchema = z.array(ProjectSchema);
export type ProjectList = z.infer<typeof ProjectListSchema>;

/** GET /api/tickets and GET /api/my-tickets. */
export const TicketListSchema = z.array(TicketSchema);
export type TicketList = z.infer<typeof TicketListSchema>;

/** GET /api/projects/:slug/boards/:board/sprints. */
export const SprintListSchema = z.array(SprintSchema);
export type SprintList = z.infer<typeof SprintListSchema>;

/** GET /api/tickets/:key/comments, oldest first. */
export const CommentListSchema = z.array(CommentSchema);
export type CommentList = z.infer<typeof CommentListSchema>;

/** GET /api/tickets/:key/links. */
export const TicketLinkListSchema = z.array(TicketLinkSchema);
export type TicketLinkList = z.infer<typeof TicketLinkListSchema>;

/** GET /api/tickets/:key/files. */
export const TicketFileListSchema = z.array(TicketFileSchema);
export type TicketFileList = z.infer<typeof TicketFileListSchema>;

/** GET /api/tickets/:key/github. */
export const GithubLinkListSchema = z.array(GithubLinkSchema);
export type GithubLinkList = z.infer<typeof GithubLinkListSchema>;

/** GET /api/tickets/:key/dod. */
export const DodListSchema = z.array(DodItemSchema);
export type DodList = z.infer<typeof DodListSchema>;

/** GET /api/users (admin only). */
export const UserListSchema = z.array(UserListItemSchema);
export type UserList = z.infer<typeof UserListSchema>;

/** GET /api/projects/:slug/docs, newest first. */
export const DocListSchema = z.array(DocSchema);
export type DocList = z.infer<typeof DocListSchema>;

/** GET /api/projects/:slug/files, newest first. */
export const ProjectFileListSchema = z.array(ProjectFileSchema);
export type ProjectFileList = z.infer<typeof ProjectFileListSchema>;

/** GET /api/projects/:slug/boards/:board/retros, newest first. */
export const RetroListSchema = z.array(RetroSchema);
export type RetroList = z.infer<typeof RetroListSchema>;

/**
 * Names the server broadcasts on GET /api/events. Each arrives as a named SSE
 * event, so a client must register a listener per name: `onmessage` never fires.
 */
export const SERVER_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.deleted',
  'comment.created',
  'handoff.created',
  'sprint.created',
  'sprint.updated',
  'sprint.deleted',
  'retro.card.created',
] as const;
export const ServerEventNameSchema = z.enum(SERVER_EVENTS);
export type ServerEventName = z.infer<typeof ServerEventNameSchema>;

export const PersonListSchema = z.array(PersonSchema);
export type PersonList = z.infer<typeof PersonListSchema>;
export const HandoffNoticeListSchema = z.array(HandoffNoticeSchema);
export type HandoffNoticeList = z.infer<typeof HandoffNoticeListSchema>;
