// The sub-ticket rules, in one place so the server's two entry points (create and attach)
// and the tests cannot drift. Hierarchy: epic > ticket > sub-ticket, and a sub-ticket is
// always one level deep. The epic relation (tickets.parent_key) is separate and untouched.

/** What the rules need to know about a ticket. */
export interface SubticketNode {
  key: string;
  type: string;
  project_slug: string;
  /** The key of the ticket this one is a sub-ticket of, if any. */
  subticket_of: string | null;
  /** Whether other tickets are sub-tickets of this one. */
  has_subtickets: boolean;
}

export const EPIC_TYPE = 'epic';

/**
 * Why `child` cannot become a sub-ticket of `parent`, or null when it can. Every
 * refusal is a 409: the request is well formed but the tickets are in the wrong state.
 */
export function subticketViolation(child: SubticketNode, parent: SubticketNode): string | null {
  if (child.key === parent.key) return 'a ticket cannot be its own parent';
  if (child.type === EPIC_TYPE) return 'an epic cannot be a sub-ticket';
  if (parent.type === EPIC_TYPE) {
    return 'an epic holds tickets, not sub-tickets: set the epic as the ticket parent instead';
  }
  if (parent.subticket_of) {
    return (
      'sub-tickets go one level deep: ' +
      parent.key +
      ' is already a sub-ticket of ' +
      parent.subticket_of
    );
  }
  if (child.has_subtickets) {
    return 'sub-tickets go one level deep: ' + child.key + ' already has sub-tickets';
  }
  if (child.project_slug !== parent.project_slug) {
    return 'a sub-ticket must be in the same project as its parent';
  }
  return null;
}

/** "1 sub-ticket is still open" / "3 sub-tickets are still open". */
export function openSubticketsMessage(open: number): string {
  return (
    open +
    (open === 1 ? ' sub-ticket is' : ' sub-tickets are') +
    ' still open: confirm to close the parent anyway'
  );
}
