// Display helpers, ported from v1's app.js. All date maths is UTC so a plain
// "YYYY-MM-DD" never shifts by a day with the viewer's time zone.

/** Assignees are an email, or on old rows a display name: "maya.okafor@x" becomes "Maya Okafor". */
export function personName(who: string | null | undefined): string {
  if (!who) return '';
  const base = who.includes('@') ? (who.split('@')[0] ?? who) : who;
  return base
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function initialsOf(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return (first.charAt(0) + (last ? last.charAt(0) : '')).toUpperCase();
}

export function hueOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

/** "3s ago", "5m ago". Input is SQLite's "YYYY-MM-DD HH:MM:SS", which is UTC. */
export function timeAgo(stamp: string | null | undefined, now: number = Date.now()): string {
  if (!stamp) return '';
  const then = new Date(stamp.replace(' ', 'T') + 'Z').getTime();
  const s = Math.max(1, Math.floor((now - then) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

const isoToday = (now: Date) => now.toISOString().slice(0, 10);

/** Whole days from today to an ISO date. Negative is in the past. */
export function dayDiff(iso: string, now: Date = new Date()): number {
  return Math.round(
    (new Date(iso + 'T00:00:00Z').getTime() - new Date(isoToday(now) + 'T00:00:00Z').getTime()) /
      86400000,
  );
}

export function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** v1's heuristic: colour a status by what its name says. Returns a CSS colour token. */
export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (/done|shipped|deployed|passed|published|resolved/.test(s)) return 'var(--c-green)';
  if (/review|qa|verify|testing/.test(s)) return 'var(--c-cyan)';
  if (/progress|building|implementation/.test(s)) return 'var(--c-blue)';
  if (/fail|blocked/.test(s)) return 'var(--c-red)';
  if (/design|cooldown/.test(s)) return 'var(--c-purple)';
  if (/waiting|triaged|ready/.test(s)) return 'var(--c-amber)';
  return 'var(--c-gray)';
}
