import { SERVER_EVENTS } from '@officepm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeysForEvent } from './event-keys';

const openEventSource = (url: string) => new EventSource(url);

/**
 * Subscribes to GET /api/events while mounted and invalidates the queries each
 * event affects. The server sends named events, so `onmessage` would never
 * fire: one listener per name. EventSource reconnects on its own; after a
 * reconnect everything is invalidated, because events sent while the stream
 * was down are gone.
 */
export function useEventStream(source: (url: string) => EventSource = openEventSource): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const stream = source('/api/events');
    let opened = false;

    stream.addEventListener('open', () => {
      if (opened) void queryClient.invalidateQueries();
      opened = true;
    });
    for (const name of SERVER_EVENTS) {
      stream.addEventListener(name, () => {
        for (const queryKey of queryKeysForEvent(name))
          void queryClient.invalidateQueries({ queryKey });
      });
    }
    return () => stream.close();
  }, [queryClient, source]);
}
