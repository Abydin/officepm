import { PRIORITIES } from '@officepm/shared';
import type { JsonBody } from '../../context.js';

/**
 * priority, labels and due_date are optional card metadata. Returns the message
 * for the first bad value, or null. Absent keys (and null) are not checked.
 * Written out by hand rather than with the shared Zod schemas because v1 reports
 * one fixed message per field and trims labels only after the length check.
 */
export function validateTicketExtras(b: JsonBody): string | null {
  if (
    b.priority !== undefined &&
    b.priority !== null &&
    !(PRIORITIES as readonly unknown[]).includes(b.priority)
  ) {
    return 'priority must be one of: ' + PRIORITIES.join(', ');
  }
  if (b.labels !== undefined && b.labels !== null) {
    if (
      !Array.isArray(b.labels) ||
      b.labels.length > 8 ||
      b.labels.some((l: unknown) => typeof l !== 'string' || !l.trim() || l.length > 24)
    ) {
      return 'labels must be an array of up to 8 short strings';
    }
  }
  if (b.due_date !== undefined && b.due_date !== null && b.due_date !== '') {
    const s = String(b.due_date);
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime());
    if (!ok) return 'due_date must be YYYY-MM-DD';
  }
  return null;
}

/** Labels are stored trimmed, as JSON text; none means NULL. */
export function labelsColumn(labels: unknown): string | null {
  return Array.isArray(labels) && labels.length
    ? JSON.stringify(labels.map((l: string) => l.trim()))
    : null;
}
