import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveStoredPath } from './paths.js';

let dataDir: string;
let outside: string;

function put(root: string, ...parts: string[]): string {
  const file = path.join(root, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  return file;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-paths-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-outside-'));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('resolveStoredPath', () => {
  it('returns the path when it is already under the current uploads dir', () => {
    const file = put(dataDir, 'uploads', 'tickets', 'FOOD-ENG-1', 'a.png');
    expect(resolveStoredPath(dataDir, file)).toBe(file);
  });

  it('re-roots a ticket file whose old data directory is gone', () => {
    const file = put(dataDir, 'uploads', 'tickets', 'FOOD-ENG-1', 'a.png');
    const stale = '/srv/old-box/officepm/uploads/tickets/FOOD-ENG-1/a.png';
    expect(resolveStoredPath(dataDir, stale)).toBe(file);
  });

  it('re-roots a project file', () => {
    const file = put(dataDir, 'uploads', 'projects', 'food', 'spec.pdf');
    expect(resolveStoredPath(dataDir, '/elsewhere/uploads/projects/food/spec.pdf')).toBe(file);
  });

  it('re-roots a Windows-style stored path', () => {
    const file = put(dataDir, 'uploads', 'tickets', 'K-1', 'a.png');
    expect(resolveStoredPath(dataDir, 'C:\\office\\uploads\\tickets\\K-1\\a.png')).toBe(file);
  });

  it('handles a data directory that itself contains "uploads"', () => {
    const file = put(dataDir, 'uploads', 'tickets', 'K-1', 'a.png');
    expect(resolveStoredPath(dataDir, '/data/uploads/uploads/tickets/K-1/a.png')).toBe(file);
  });

  it('returns null when the file is missing from the current directory', () => {
    expect(resolveStoredPath(dataDir, '/old/uploads/tickets/K-1/gone.png')).toBeNull();
  });

  it('never returns a file that exists outside the data directory', () => {
    const elsewhere = put(outside, 'uploads', 'tickets', 'K-1', 'a.png');
    expect(fs.existsSync(elsewhere)).toBe(true);
    expect(resolveStoredPath(dataDir, elsewhere)).toBeNull();
  });

  it('rejects .. segments and NUL bytes', () => {
    put(dataDir, 'uploads', 'tickets', 'K-1', 'a.png');
    expect(resolveStoredPath(dataDir, '/old/uploads/tickets/../tickets/K-1/a.png')).toBeNull();
    expect(resolveStoredPath(dataDir, '/old/uploads/tickets/K-1/../../x/a.png')).toBeNull();
    expect(resolveStoredPath(dataDir, '/old/uploads/tickets/K-1/a.png\0.txt')).toBeNull();
    expect(resolveStoredPath(dataDir, '/old/uploads/tickets/K\0-1/a.png')).toBeNull();
    expect(resolveStoredPath(dataDir, '/old/uploads/tickets/K-1/..')).toBeNull();
  });

  it('rejects shapes that are not an upload path', () => {
    put(dataDir, 'uploads', 'tickets', 'K-1', 'a.png');
    for (const bad of [
      '',
      '/etc/passwd',
      'a.png',
      '/x/uploads/other/K-1/a.png',
      '/x/uploads/tickets/a.png',
    ]) {
      expect(resolveStoredPath(dataDir, bad)).toBeNull();
    }
  });

  it('refuses a symlink that leads out of the uploads directory', () => {
    const secret = put(outside, 'secret.txt');
    const dir = path.join(dataDir, 'uploads', 'tickets', 'K-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(secret, path.join(dir, 'link.png'));
    expect(resolveStoredPath(dataDir, '/old/uploads/tickets/K-1/link.png')).toBeNull();
  });

  it('does not return directories', () => {
    fs.mkdirSync(path.join(dataDir, 'uploads', 'tickets', 'K-1', 'sub'), { recursive: true });
    expect(resolveStoredPath(dataDir, '/old/uploads/tickets/K-1/sub')).toBeNull();
  });
});
