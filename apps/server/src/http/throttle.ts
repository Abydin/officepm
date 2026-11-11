/**
 * Failed-login throttle. Counts failures, not attempts, so ordinary use never
 * trips it, per client address and per email. A key is blocked once it has
 * `limit` failures inside the window and stays blocked until the oldest of them
 * ages out. A successful login clears that email's failures (not the address's).
 *
 * In memory on purpose: one process, and a restart clearing it is acceptable
 * for an office tool. Entries are swept as they expire and the map is capped.
 */
export interface ThrottleOptions {
  windowMs: number;
  perEmail: number;
  perIp: number;
  maxKeys: number;
  now: () => number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  windowMs: 15 * 60 * 1000,
  perEmail: 8,
  perIp: 30,
  maxKeys: 10_000,
  now: Date.now,
};

export class LoginThrottle {
  private readonly opts: ThrottleOptions;
  private readonly failures = new Map<string, number[]>();

  constructor(opts: Partial<ThrottleOptions> = {}) {
    this.opts = { ...DEFAULT_THROTTLE, ...opts };
  }

  private recent(key: string): number[] {
    const cutoff = this.opts.now() - this.opts.windowMs;
    const live = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (live.length) this.failures.set(key, live);
    else this.failures.delete(key);
    return live;
  }

  /** Seconds until the next attempt is allowed, or 0 when it may go ahead. */
  retryAfter(ip: string, email: string): number {
    let wait = 0;
    for (const [key, limit] of [
      ['ip:' + ip, this.opts.perIp],
      ['email:' + email, this.opts.perEmail],
    ] as const) {
      const live = this.recent(key);
      if (live.length >= limit) {
        // The block lifts when enough old failures age out to drop under the limit.
        const frees = (live[live.length - limit] as number) + this.opts.windowMs;
        wait = Math.max(wait, Math.ceil((frees - this.opts.now()) / 1000));
      }
    }
    return wait;
  }

  recordFailure(ip: string, email: string): void {
    for (const key of ['ip:' + ip, 'email:' + email]) {
      const live = this.recent(key);
      live.push(this.opts.now());
      this.failures.set(key, live);
    }
    if (this.failures.size > this.opts.maxKeys) this.evict();
  }

  recordSuccess(email: string): void {
    this.failures.delete('email:' + email);
  }

  /** Drops expired keys, then the oldest ones if the map is still over its cap. */
  private evict(): void {
    for (const key of [...this.failures.keys()]) this.recent(key);
    const excess = this.failures.size - this.opts.maxKeys;
    if (excess > 0) {
      for (const key of [...this.failures.keys()].slice(0, excess)) this.failures.delete(key);
    }
  }
}
