import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupAll, snapshotDatabase } from './backup.js';
import { openDatabase } from './db/index.js';

describe('SQLite backup', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-backup-test-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const seed = () => {
    const db = openDatabase({ dataDir: dir });
    // A big enough write that, with WAL on, much of it is still only in pm.db-wal.
    db.raw.pragma('wal_autocheckpoint = 0');
    db.raw.prepare("INSERT INTO users (email, name, password) VALUES ('a@x', 'A', 'h')").run();
    const insert = db.raw.prepare(
      "INSERT INTO comments (ticket_key, author, body, source) VALUES ('T-1', 'a', ?, 'user')",
    );
    for (let i = 0; i < 500; i++) insert.run('row ' + i);
    return db;
  };

  it('copies rows that live only in the WAL, which a plain file copy of pm.db would miss', async () => {
    const db = seed();
    const walBytes = fs.statSync(path.join(dir, 'pm.db-wal')).size;
    expect(walBytes).toBeGreaterThan(0);

    const naive = path.join(dir, 'naive.db');
    fs.copyFileSync(path.join(dir, 'pm.db'), naive);
    // Here even the schema is still in the WAL, so the plain copy is not a usable database.
    let naiveRows = 0;
    try {
      const plain = new Database(naive, { readonly: true });
      naiveRows = (plain.prepare('SELECT count(*) AS n FROM comments').get() as { n: number }).n;
      plain.close();
    } catch {
      naiveRows = 0;
    }

    const snap = path.join(dir, 'snap.db');
    await snapshotDatabase(path.join(dir, 'pm.db'), snap);
    const copy = new Database(snap, { readonly: true });
    expect((copy.prepare('SELECT count(*) AS n FROM comments').get() as { n: number }).n).toBe(500);
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    copy.close();
    // The comparison that justifies the API: the naive copy lost the WAL's rows.
    expect(naiveRows).toBeLessThan(500);
    db.close();
  });

  it('is consistent while the server keeps writing', async () => {
    const db = seed();
    const writer = setInterval(() => {
      db.raw
        .prepare(
          "INSERT INTO comments (ticket_key, author, body, source) VALUES ('T-1','a','w','user')",
        )
        .run();
    }, 1);
    try {
      const snap = path.join(dir, 'snap.db');
      await snapshotDatabase(path.join(dir, 'pm.db'), snap);
      const copy = new Database(snap, { readonly: true });
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(
        (copy.prepare('SELECT count(*) AS n FROM comments').get() as { n: number }).n,
      ).toBeGreaterThanOrEqual(500);
      copy.close();
    } finally {
      clearInterval(writer);
      db.close();
    }
  });

  it('refuses a database that does not exist rather than writing an empty backup', async () => {
    await expect(
      snapshotDatabase(path.join(dir, 'missing.db'), path.join(dir, 'x.db')),
    ).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'x.db'))).toBe(false);
  });

  it("does not call a snapshot good when it fails SQLite's integrity check", async () => {
    const file = path.join(dir, 'damaged.db');
    const db = new Database(file);
    db.exec('CREATE TABLE t (a INTEGER, b TEXT); CREATE INDEX t_b ON t (b)');
    const insert = db.prepare('INSERT INTO t VALUES (?, ?)');
    for (let i = 0; i < 20; i++) insert.run(i, 'needle-' + i);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    // Change the text in one place only (the first copy, in the table). Every page still
    // reads fine, so the backup copies it, but the index now disagrees with the table.
    const bytes = fs.readFileSync(file);
    const at = bytes.indexOf('needle-7');
    expect(at).toBeGreaterThan(0);
    bytes[at] = 'N'.charCodeAt(0);
    fs.writeFileSync(file, bytes);

    await expect(snapshotDatabase(file, path.join(dir, 'copy.db'))).rejects.toThrow(
      /integrity check/,
    );
  });

  it('writes one archive holding the snapshot, projects.json and uploads', async () => {
    const db = seed();
    db.close();
    fs.mkdirSync(path.join(dir, 'uploads/projects/p'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'uploads/projects/p/f.txt'), 'hello');
    const projectsFile = path.join(dir, 'projects.json');
    fs.writeFileSync(projectsFile, '{"projects":[]}');

    const { archive } = await backupAll({
      dataDir: dir,
      projectsFile,
      outDir: path.join(dir, 'out'),
      date: '2026-01-02',
    });
    expect(path.basename(archive)).toBe('pm-backup-2026-01-02.tar.gz');
    expect(fs.existsSync(archive + '.partial')).toBe(false);

    const restore = path.join(dir, 'restore');
    fs.mkdirSync(restore);
    execFileSync('tar', ['-xzf', archive, '-C', restore]);
    expect(fs.readFileSync(path.join(restore, 'uploads/projects/p/f.txt'), 'utf8')).toBe('hello');
    expect(fs.readFileSync(path.join(restore, 'projects.json'), 'utf8')).toBe('{"projects":[]}');
    const restored = new Database(path.join(restore, 'pm.db'), { readonly: true });
    expect((restored.prepare('SELECT count(*) AS n FROM comments').get() as { n: number }).n).toBe(
      500,
    );
    restored.close();
  });
});
