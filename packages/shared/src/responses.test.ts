import { describe, expect, it } from 'vitest';
import {
  ProjectListSchema,
  SERVER_EVENTS,
  ServerEventNameSchema,
  TicketListSchema,
} from './index.js';

describe('responses', () => {
  it('accepts empty lists and rejects a non-array', () => {
    expect(ProjectListSchema.parse([])).toEqual([]);
    expect(TicketListSchema.parse([])).toEqual([]);
    expect(TicketListSchema.safeParse({}).success).toBe(false);
  });

  it('lists each server event once, with a dot-separated name', () => {
    expect(new Set(SERVER_EVENTS).size).toBe(SERVER_EVENTS.length);
    for (const name of SERVER_EVENTS) expect(name).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    expect(ServerEventNameSchema.safeParse('ticket.updated').success).toBe(true);
    expect(ServerEventNameSchema.safeParse('nope').success).toBe(false);
  });
});
