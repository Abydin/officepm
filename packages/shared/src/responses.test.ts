import { describe, expect, it } from 'vitest';
import {
  CommentListSchema,
  DodListSchema,
  GithubLinkListSchema,
  ProjectListSchema,
  SERVER_EVENTS,
  ServerEventNameSchema,
  TicketFileListSchema,
  TicketLinkListSchema,
  TicketListSchema,
  UserListSchema,
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

  it('validates the ticket drawer lists', () => {
    expect(
      CommentListSchema.parse([
        { id: 1, ticket_key: 'A-1', author: 'Maya', body: 'hi', source: 'user', created_at: 'x' },
      ]),
    ).toHaveLength(1);
    expect(CommentListSchema.safeParse([{ id: 1 }]).success).toBe(false);
    expect(DodListSchema.parse([{ item: 'Tests pass', done: false }])).toHaveLength(1);
    expect(TicketLinkListSchema.parse([])).toEqual([]);
    expect(TicketFileListSchema.parse([])).toEqual([]);
    expect(GithubLinkListSchema.parse([])).toEqual([]);
    expect(UserListSchema.safeParse({}).success).toBe(false);
  });
});
