import type { Ticket } from '@officepm/shared';
import type { schema } from '../../db/index.js';

export type TicketRow = typeof schema.tickets.$inferSelect;

export function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** Table row to API shape: JSON text becomes arrays, 0/1 becomes a boolean. */
export function serializeTicket(row: TicketRow): Ticket {
  return {
    ...row,
    acceptance_criteria: row.acceptance_criteria ? JSON.parse(row.acceptance_criteria) : [],
    labels: parseLabels(row.labels),
    blocked: !!row.blocked,
  } as Ticket;
}
