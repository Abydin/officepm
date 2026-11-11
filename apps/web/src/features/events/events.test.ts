import { SERVER_EVENTS } from '@officepm/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { qk } from '@/lib/api';
import { queryKeysForEvent } from './event-keys';
import { useEventStream } from './use-event-stream';

class FakeEventSource {
  listeners = new Map<string, Array<() => void>>();
  closed = false;
  addEventListener(name: string, fn: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(name: string) {
    for (const fn of this.listeners.get(name) ?? []) fn();
  }
}

function setup() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const source = new FakeEventSource();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useEventStream(() => source as unknown as EventSource), {
    wrapper,
  });
  return { source, invalidate, ...hook };
}

describe('queryKeysForEvent', () => {
  it('maps every server event to at least one query key', () => {
    for (const name of SERVER_EVENTS) expect(queryKeysForEvent(name).length).toBeGreaterThan(0);
  });

  it('ticket and sprint events refresh the dashboard too', () => {
    expect(queryKeysForEvent('ticket.updated')).toEqual([qk.tickets.all, qk.dashboard]);
    expect(queryKeysForEvent('sprint.created')).toEqual([qk.sprints.all, qk.dashboard]);
    expect(queryKeysForEvent('retro.card.created')).toEqual([qk.retros.all]);
  });

  it('a sprint update also refreshes retros, because completing one creates its retro', () => {
    expect(queryKeysForEvent('sprint.updated')).toContain(qk.retros.all);
  });
});

describe('useEventStream', () => {
  it('listens for each named event (onmessage never fires for these)', () => {
    const { source } = setup();
    for (const name of SERVER_EVENTS) expect(source.listeners.has(name)).toBe(true);
  });

  it('invalidates the affected queries when an event arrives', () => {
    const { source, invalidate } = setup();
    source.emit('ticket.created');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.tickets.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.dashboard });
  });

  it('invalidates everything after a reconnect, but not on the first open', () => {
    const { source, invalidate } = setup();
    source.emit('open');
    expect(invalidate).not.toHaveBeenCalled();
    source.emit('open');
    expect(invalidate).toHaveBeenCalledWith();
  });

  it('closes the stream on unmount', () => {
    const { source, unmount } = setup();
    unmount();
    expect(source.closed).toBe(true);
  });
});
