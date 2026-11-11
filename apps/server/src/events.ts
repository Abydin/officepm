const HEARTBEAT_MS = 25_000;

type Listener = (chunk: string) => void;

/** Who a stream belongs to, and how to end it from the server side. */
export interface StreamOwner {
  userId: number;
  sessionId: string;
  close: () => void;
}

interface Subscription {
  listener: Listener;
  owner?: StreamOwner;
}

/** In-process fan-out for server-sent events. One instance per server. */
export class EventBus {
  private readonly listeners = new Set<Subscription>();
  private timer: NodeJS.Timeout | null = null;

  /**
   * Registers a listener, returns the function that removes it. An owner lets the
   * server end the stream itself (closeForUser, closeForSession).
   */
  subscribe(listener: Listener, owner?: StreamOwner): () => void {
    const sub: Subscription = { listener, owner };
    this.listeners.add(sub);
    return () => {
      this.listeners.delete(sub);
    };
  }

  /** Ends every stream of a user, e.g. after a password reset. Returns how many. */
  closeForUser(userId: number): number {
    return this.closeWhere((o) => o.userId === userId);
  }

  /** Ends the streams opened with one session, e.g. on logout. Returns how many. */
  closeForSession(sessionId: string): number {
    return this.closeWhere((o) => o.sessionId === sessionId);
  }

  private closeWhere(match: (owner: StreamOwner) => boolean): number {
    let closed = 0;
    for (const sub of [...this.listeners]) {
      if (!sub.owner || !match(sub.owner)) continue;
      this.listeners.delete(sub);
      try {
        sub.owner.close();
      } catch {
        // Already closed from the client side.
      }
      closed++;
    }
    return closed;
  }

  broadcast(event: string, data: unknown): void {
    this.send('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  }

  /** Keeps idle connections open through proxies. Does not hold the process up. */
  startHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.send(': heartbeat\n\n'), HEARTBEAT_MS);
    this.timer.unref();
  }

  stopHeartbeat(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private send(chunk: string): void {
    for (const { listener } of this.listeners) {
      try {
        listener(chunk);
      } catch {
        // The client is gone; its stream's cancel handler removes it.
      }
    }
  }
}
