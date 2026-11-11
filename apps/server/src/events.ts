const HEARTBEAT_MS = 25_000;

type Listener = (chunk: string) => void;

/** In-process fan-out for server-sent events. One instance per server. */
export class EventBus {
  private readonly listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | null = null;

  /** Registers a listener, returns the function that removes it. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
    for (const listener of this.listeners) {
      try {
        listener(chunk);
      } catch {
        // The client is gone; its stream's cancel handler removes it.
      }
    }
  }
}
