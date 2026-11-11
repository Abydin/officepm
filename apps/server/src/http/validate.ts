import { firstRequestIssue } from '@officepm/shared';
import { badRequest } from './errors.js';

type RequestSchema = Parameters<typeof firstRequestIssue>[0];

/**
 * Rejects a body whose fields have the wrong type, with a 400. Call it AFTER the
 * service's own presence and value checks, which carry v1's exact messages, so this
 * only ever speaks for cases v1 turned into a 500 or stored as garbage.
 */
export function requireShape(schema: RequestSchema, body: unknown): void {
  const issue = firstRequestIssue(schema, body);
  if (issue) throw badRequest(issue);
}
