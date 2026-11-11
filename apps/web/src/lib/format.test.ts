import { describe, expect, it } from 'vitest';
import { dayDiff, initialsOf, personName, shortDate, statusColor, timeAgo } from './format';

describe('format', () => {
  it('turns an email or a name into a readable person', () => {
    expect(personName('maya.okafor@officepm.demo')).toBe('Maya Okafor');
    expect(personName('Tunde Bakare')).toBe('Tunde Bakare');
    expect(personName(null)).toBe('');
    expect(initialsOf('Maya Okafor')).toBe('MO');
    expect(initialsOf('Cher')).toBe('C');
    expect(initialsOf('')).toBe('?');
  });

  it('reads SQLite timestamps as UTC', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    expect(timeAgo('2026-11-11 11:59:30', now)).toBe('30s ago');
    expect(timeAgo('2026-11-11 11:15:00', now)).toBe('45m ago');
    expect(timeAgo('2026-11-11 09:00:00', now)).toBe('3h ago');
    expect(timeAgo('2026-11-08 12:00:00', now)).toBe('3d ago');
    expect(timeAgo(null, now)).toBe('');
  });

  it('counts whole days between calendar dates without a time-zone shift', () => {
    const now = new Date('2026-11-11T23:30:00Z');
    expect(dayDiff('2026-11-11', now)).toBe(0);
    expect(dayDiff('2026-11-14', now)).toBe(3);
    expect(dayDiff('2026-11-10', now)).toBe(-1);
    expect(shortDate('2026-11-03')).toBe('3 Nov');
  });

  it('colours a status by what its name says', () => {
    expect(statusColor('Done')).toBe('var(--c-green)');
    expect(statusColor('Code Review')).toBe('var(--c-cyan)');
    expect(statusColor('In Progress')).toBe('var(--c-blue)');
    expect(statusColor('Backlog')).toBe('var(--c-gray)');
  });
});
