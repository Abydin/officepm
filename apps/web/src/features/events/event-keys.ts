import type { QueryKey } from '@tanstack/react-query';
import type { ServerEventName } from '@officepm/shared';
import { qk } from '@/lib/api';

/**
 * Which cached queries a server event makes stale. The dashboard summarises
 * tickets, sprints and comments, so every one of those events touches it.
 * Exhaustive over ServerEventName: adding an event to the shared list fails
 * the type check here until someone decides what it invalidates.
 */
export function queryKeysForEvent(name: ServerEventName): readonly QueryKey[] {
  switch (name) {
    case 'ticket.created':
    case 'ticket.updated':
    case 'ticket.deleted':
    case 'ticket.participants.changed':
      return [qk.tickets.all, qk.dashboard];
    case 'handoff.created':
      // The move and the comment arrive as their own events; this one is for the recipient's unread list.
      return [qk.handoffs.all];
    case 'comment.created':
      return [qk.comments.all, qk.dashboard];
    case 'sprint.created':
    case 'sprint.deleted':
      return [qk.sprints.all, qk.dashboard];
    case 'sprint.updated':
      // Completing a sprint makes the server create its retro, and announces only the sprint.
      return [qk.sprints.all, qk.retros.all, qk.dashboard];
    case 'pipeline.changed':
      // A project's phase list changed: the settings screen and every epic stepper read it.
      return [qk.projects.all, qk.tickets.all];
    case 'retro.card.created':
      return [qk.retros.all];
  }
}
