import net from 'node:net';

/**
 * Failed-login throttle. Counts failures, not attempts, so ordinary use never
 * trips it. Three keys are kept per attempt:
 *
 *  - the client address (IPv6 by its /64): `perIp` failures in the window;
 *  - the (address, email) pair: `perEmail` failures in the window;
 *  - the email alone, a much higher ceiling (`perEmailGlobal`) that only bites
 *    clients that already have a failure of their own on that email.
 *
 * Keying the email limit on the pair means a stranger cannot lock an account out
 * for everyone by failing its login: they only exhaust their own pair. The global
 * ceiling still slows a distributed guesser, but a client with no failures of its
 * own on that email is never stopped by it.
 *
 * An attempt is counted when it is admitted, synchronously and before the bcrypt
 * compare is awaited, so a parallel burst cannot all slip past the check. A
 * successful login refunds its own count and clears its pair's failures.
 *
 * In memory on purpose: one process, and a restart clearing it is acceptable
 * for an office tool. Expired entries are swept; the map is capped, and when it
 * is full of live entries an unknown key is refused rather than a live one dropped.
 */
export interface ThrottleOptions {
  windowMs: number;
  perEmail: number;
  perEmailGlobal: number;
  perIp: number;
  maxKeys: number;
  now: () => number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  windowMs: 15 * 60 * 1000,
  perEmail: 8,
  perEmailGlobal: 100,
  perIp: 30,
  maxKeys: 10_000,
  now: Date.now,
};

/**
 * The key a client address is throttled under. IPv6 is cut to its /64, the
 * smallest block one subscriber normally holds, so rotating through a /64 does
 * not mint fresh budgets. An IPv4-mapped IPv6 address counts as its IPv4.
 * Anything that is not an IP literal is kept as written.
 */
export function clientKey(ip: string): string {
  const bare = ip.trim().toLowerCase().split('%')[0] as string;
  const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(bare)?.[1];
  if (mapped && net.isIPv4(mapped)) return mapped;
  if (!net.isIPv6(bare)) return ip.trim();
  const [head = '', tail] = bare.split('::') as [string, string?];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return (
    'v6:' +
    groups
      .slice(0, 4)
      .map((g) => g.padStart(4, '0'))
      .join(':')
  );
}

/** What `begin` hands back: how long to wait, or 0 when the attempt was admitted. */
export interface Attempt {
  wait: number;
  /** Call when the password was right: refunds this attempt and clears the pair's failures. */
  success(): void;
}

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

  private keys(ip: string, email: string) {
    const addr = clientKey(ip);
    return { ip: 'ip:' + addr, pair: `pair:${addr}|${email}`, email: 'email:' + email };
  }

  /** Seconds until `live` (at `limit` or over) drops under the limit. */
  private until(live: number[], limit: number): number {
    const frees = (live[live.length - limit] as number) + this.opts.windowMs;
    return Math.max(1, Math.ceil((frees - this.opts.now()) / 1000));
  }

  private check(k: { ip: string; pair: string; email: string }): number {
    let wait = 0;
    const ip = this.recent(k.ip);
    if (ip.length >= this.opts.perIp) wait = Math.max(wait, this.until(ip, this.opts.perIp));
    const pair = this.recent(k.pair);
    if (pair.length >= this.opts.perEmail) {
      wait = Math.max(wait, this.until(pair, this.opts.perEmail));
    }
    // The global ceiling only stops a client that already has a failure of its own here.
    const email = this.recent(k.email);
    if (pair.length > 0 && email.length >= this.opts.perEmailGlobal) {
      wait = Math.max(wait, this.until(email, this.opts.perEmailGlobal));
    }
    return wait;
  }

  /** Seconds until the next attempt is allowed, or 0 when it may go ahead. Does not count. */
  retryAfter(ip: string, email: string): number {
    return this.check(this.keys(ip, email));
  }

  /**
   * Checks and counts in one synchronous step. When it returns `wait` 0 the attempt
   * already counts as a failure; it stays one unless `success()` is called.
   */
  begin(ip: string, email: string): Attempt {
    const k = this.keys(ip, email);
    const refused = (wait: number): Attempt => ({ wait, success() {} });
    const wait = this.check(k);
    if (wait > 0) return refused(wait);
    const at = this.add(k);
    if (at === undefined) return refused(this.fullWait());
    return {
      wait: 0,
      success: () => {
        this.refund(k.ip, at);
        this.refund(k.email, at);
        this.failures.delete(k.pair);
      },
    };
  }

  /** Counts a failure that was not admitted through `begin`. Dropped if the map is full. */
  recordFailure(ip: string, email: string): void {
    this.add(this.keys(ip, email));
  }

  private add(k: { ip: string; pair: string; email: string }): number | undefined {
    const names = [k.ip, k.pair, k.email];
    if (!this.hasRoom(names)) return undefined;
    const at = this.opts.now();
    for (const key of names) {
      const live = this.recent(key);
      live.push(at);
      this.failures.set(key, live);
    }
    return at;
  }

  private refund(key: string, at: number): void {
    const live = this.failures.get(key);
    const i = live ? live.indexOf(at) : -1;
    if (!live || i < 0) return;
    live.splice(i, 1);
    if (!live.length) this.failures.delete(key);
  }

  /**
   * Room for the keys an attempt needs. Only expired entries are ever dropped; when
   * the map is full of live ones, an unknown key is refused (fail closed) instead.
   */
  private hasRoom(names: string[]): boolean {
    const missing = names.filter((n) => !this.failures.has(n)).length;
    if (this.failures.size + missing <= this.opts.maxKeys) return true;
    for (const key of [...this.failures.keys()]) this.recent(key);
    return this.failures.size + missing <= this.opts.maxKeys;
  }

  /** Seconds until the first live entry expires, for an attempt refused because the map is full. */
  private fullWait(): number {
    let soonest = Infinity;
    for (const live of this.failures.values()) {
      soonest = Math.min(soonest, (live[live.length - 1] as number) + this.opts.windowMs);
    }
    return Math.max(1, Math.ceil((soonest - this.opts.now()) / 1000));
  }
}
