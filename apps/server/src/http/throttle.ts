import net from 'node:net';

/**
 * Failed-login throttle. Counts failures, not attempts, so ordinary use never
 * trips it. Up to four keys are kept per attempt, each in its own bounded map so
 * a flood of one kind cannot crowd out the others:
 *
 *  - the client address, in full (an IPv6 address keeps every group, and the zone
 *    id of a link-local one): `perIp` failures in the window;
 *  - for IPv6 only, its /64: `perNet` failures, several times `perIp`, so two
 *    addresses of one subscriber do not share the strict budget but a client
 *    rotating through a whole /64 is still capped;
 *  - the (address, email) pair: `perEmail` failures in the window;
 *  - the email alone, a much higher ceiling (`perEmailGlobal`).
 *
 * Keying the email limit on the pair means a stranger cannot lock an account out
 * for everyone by failing its login: they only exhaust their own pair. Past the
 * ceiling, a client that already has failures of its own on that email is held,
 * and a client with none is admitted at a reduced rate (one new address per
 * `slowdownMs`) instead of being passed through untouched.
 *
 * Emails with no account are counted against the address only (`known` false):
 * they never create pair or email entries, so a flood of made-up emails cannot
 * fill those maps.
 *
 * An attempt is counted when it is admitted, synchronously and before the bcrypt
 * compare is awaited, so a parallel burst cannot all slip past the check. A
 * successful login refunds its own count and clears its pair's failures.
 *
 * In memory on purpose: one process, and a restart clearing it is acceptable
 * for an office tool. Each map holds `maxKeys` entries. When one is full, expired
 * entries are swept first. If it is still full, a NEW address is refused (fail
 * closed, a live block is never dropped to make room), while a full pair, email or
 * /64 map only leaves that new key untracked: the client is still bounded by its
 * own address limit, so a flood there cannot lock out clients that are under it.
 */
export interface ThrottleOptions {
  windowMs: number;
  perEmail: number;
  perEmailGlobal: number;
  perIp: number;
  /** Failures per IPv6 /64 in the window. */
  perNet: number;
  /** Past the email ceiling, the gap enforced between new addresses trying that email. */
  slowdownMs: number;
  /** Capacity of each of the four maps. */
  maxKeys: number;
  now: () => number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  windowMs: 15 * 60 * 1000,
  perEmail: 8,
  perEmailGlobal: 100,
  perIp: 30,
  perNet: 150,
  slowdownMs: 2000,
  maxKeys: 10_000,
  now: Date.now,
};

/** An IPv6 literal as eight zero-padded groups plus its zone id, or undefined when it is not one. */
function expandV6(raw: string): { groups: string[]; zone: string } | undefined {
  const [addr = '', ...zone] = raw.trim().split('%');
  if (!net.isIPv6(addr)) return undefined;
  let text = addr.toLowerCase();
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const hex = (a: string, b: string) => (Number(a) * 256 + Number(b)).toString(16);
    text = `${dotted[1]}${hex(dotted[2] as string, dotted[3] as string)}:${hex(dotted[4] as string, dotted[5] as string)}`;
  }
  const [head = '', tail] = text.split('::') as [string, string?];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return { groups: groups.map((g) => g.padStart(4, '0')), zone: zone.join('%') };
}

/** An IPv4-mapped IPv6 address, as its IPv4, or undefined. */
function mappedV4(raw: string): string | undefined {
  const bare = raw.trim().toLowerCase().split('%')[0] as string;
  const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(bare)?.[1];
  return mapped && net.isIPv4(mapped) ? mapped : undefined;
}

/**
 * The key a client address is throttled under: the full address. IPv6 is written
 * in full and lower case, and a link-local address keeps its zone id, since the
 * same fe80:: address on two interfaces is two different hosts. An IPv4-mapped
 * IPv6 address counts as its IPv4. Anything that is not an IP literal is kept as written.
 */
export function clientKey(ip: string): string {
  const mapped = mappedV4(ip);
  if (mapped) return mapped;
  const v6 = expandV6(ip);
  if (!v6) return ip.trim();
  return 'v6:' + v6.groups.join(':') + (v6.zone ? '%' + v6.zone : '');
}

/**
 * The aggregate key for an IPv6 address: its /64, the smallest block one subscriber
 * normally holds. Undefined for IPv4, a mapped IPv4 and anything that is not IPv6.
 */
export function networkKey(ip: string): string | undefined {
  if (mappedV4(ip)) return undefined;
  const v6 = expandV6(ip);
  return v6 ? 'net:' + v6.groups.slice(0, 4).join(':') : undefined;
}

/** What `begin` hands back: how long to wait, or 0 when the attempt was admitted. */
export interface Attempt {
  wait: number;
  /** Call when the password was right: refunds this attempt and clears the pair's failures. */
  success(): void;
}

/** One bounded map of failure timestamps. */
class Bucket {
  readonly map = new Map<string, number[]>();
  private swept = -Infinity;

  constructor(
    private readonly opts: ThrottleOptions,
    private readonly max: number,
  ) {}

  get size(): number {
    return this.map.size;
  }

  recent(key: string): number[] {
    const cutoff = this.opts.now() - this.opts.windowMs;
    const live = (this.map.get(key) ?? []).filter((t) => t > cutoff);
    if (live.length) this.map.set(key, live);
    else this.map.delete(key);
    return live;
  }

  /** Room for `key`: known keys always fit; otherwise expired entries are swept before giving up. */
  hasRoom(key: string): boolean {
    if (this.map.has(key) || this.map.size < this.max) return true;
    const now = this.opts.now();
    // A sweep walks every key, so a flood of new keys must not trigger one per attempt.
    if (now - this.swept >= 1000) {
      this.swept = now;
      for (const k of [...this.map.keys()]) this.recent(k);
    }
    return this.map.size < this.max;
  }

  push(key: string, at: number): void {
    const live = this.recent(key);
    live.push(at);
    this.map.set(key, live);
  }

  refund(key: string, at: number): void {
    const live = this.map.get(key);
    const i = live ? live.indexOf(at) : -1;
    if (!live || i < 0) return;
    live.splice(i, 1);
    if (!live.length) this.map.delete(key);
  }

  /** Time at which the earliest-expiring live entry frees up. */
  soonestExpiry(): number {
    let soonest = Infinity;
    for (const live of this.map.values()) {
      soonest = Math.min(soonest, (live[live.length - 1] as number) + this.opts.windowMs);
    }
    return soonest;
  }
}

interface Keys {
  ip: string;
  net: string | undefined;
  pair: string;
  email: string;
  known: boolean;
}

export class LoginThrottle {
  private readonly opts: ThrottleOptions;
  private readonly ips: Bucket;
  private readonly nets: Bucket;
  private readonly pairs: Bucket;
  private readonly emails: Bucket;

  constructor(opts: Partial<ThrottleOptions> = {}) {
    this.opts = { ...DEFAULT_THROTTLE, ...opts };
    this.ips = new Bucket(this.opts, this.opts.maxKeys);
    this.nets = new Bucket(this.opts, this.opts.maxKeys);
    this.pairs = new Bucket(this.opts, this.opts.maxKeys);
    this.emails = new Bucket(this.opts, this.opts.maxKeys);
  }

  /** Live entry counts per map, for tests and diagnostics. */
  sizes(): { ip: number; net: number; pair: number; email: number } {
    return {
      ip: this.ips.size,
      net: this.nets.size,
      pair: this.pairs.size,
      email: this.emails.size,
    };
  }

  private keys(ip: string, email: string, known: boolean): Keys {
    const addr = clientKey(ip);
    return { ip: addr, net: networkKey(ip), pair: `${addr}|${email}`, email, known };
  }

  /** Seconds until `live` (at `limit` or over) drops under the limit. */
  private until(live: number[], limit: number): number {
    const frees = (live[live.length - limit] as number) + this.opts.windowMs;
    return Math.max(1, Math.ceil((frees - this.opts.now()) / 1000));
  }

  private check(k: Keys): number {
    const { perIp, perNet, perEmail, perEmailGlobal, slowdownMs } = this.opts;
    let wait = 0;
    const ip = this.ips.recent(k.ip);
    if (ip.length >= perIp) wait = Math.max(wait, this.until(ip, perIp));
    if (k.net) {
      const net = this.nets.recent(k.net);
      if (net.length >= perNet) wait = Math.max(wait, this.until(net, perNet));
    }
    if (!k.known) return wait;
    const pair = this.pairs.recent(k.pair);
    if (pair.length >= perEmail) wait = Math.max(wait, this.until(pair, perEmail));
    const email = this.emails.recent(k.email);
    if (email.length >= perEmailGlobal) {
      if (pair.length > 0) {
        // A client with failures of its own on this email is held while the flood lasts.
        wait = Math.max(wait, this.until(email, perEmailGlobal));
      } else {
        // A new address is let through at a reduced rate: one per slowdownMs.
        const last = email[email.length - 1] as number;
        const gap = Math.ceil((last + slowdownMs - this.opts.now()) / 1000);
        wait = Math.max(wait, gap);
      }
    }
    return wait;
  }

  /** Seconds until the next attempt is allowed, or 0 when it may go ahead. Does not count. */
  retryAfter(ip: string, email: string, known = true): number {
    return this.check(this.keys(ip, email, known));
  }

  /**
   * Checks and counts in one synchronous step. When it returns `wait` 0 the attempt
   * already counts as a failure; it stays one unless `success()` is called. Pass
   * `known` false for an email with no account: it is then counted against the
   * address only and creates no pair or email entry.
   */
  begin(ip: string, email: string, known = true): Attempt {
    const k = this.keys(ip, email, known);
    const refused = (wait: number): Attempt => ({ wait, success() {} });
    const wait = this.check(k);
    if (wait > 0) return refused(wait);
    const at = this.add(k);
    if (at === undefined) return refused(this.fullWait());
    return {
      wait: 0,
      success: () => {
        this.ips.refund(k.ip, at);
        if (k.net) this.nets.refund(k.net, at);
        if (k.known) {
          this.emails.refund(k.email, at);
          this.pairs.map.delete(k.pair);
        }
      },
    };
  }

  /** Counts a failure that was not admitted through `begin`. Dropped if the address map is full. */
  recordFailure(ip: string, email: string, known = true): void {
    this.add(this.keys(ip, email, known));
  }

  private add(k: Keys): number | undefined {
    // The address map is the one that fails closed: a new address with no room is refused.
    if (!this.ips.hasRoom(k.ip)) return undefined;
    const at = this.opts.now();
    this.ips.push(k.ip, at);
    // The others only bound an address further. When one is full, that key goes
    // untracked and the address limit still applies.
    if (k.net && this.nets.hasRoom(k.net)) this.nets.push(k.net, at);
    if (k.known) {
      if (this.pairs.hasRoom(k.pair)) this.pairs.push(k.pair, at);
      if (this.emails.hasRoom(k.email)) this.emails.push(k.email, at);
    }
    return at;
  }

  /** Seconds until the first live address entry expires, for an attempt refused because the map is full. */
  private fullWait(): number {
    return Math.max(1, Math.ceil((this.ips.soonestExpiry() - this.opts.now()) / 1000));
  }
}
