import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { dbFilePath } from './db/open.js';

export interface BackupResult {
  /** The archive written. */
  archive: string;
  /** Bytes of the database snapshot inside it. */
  dbBytes: number;
}

/**
 * Writes a consistent copy of a live database with SQLite's online backup API.
 * Unlike copying or tarring pm.db, it is correct while the server is writing and
 * in WAL mode (a plain copy can miss pages still in the -wal file or tear them).
 * The copy is checked with PRAGMA integrity_check before it is trusted.
 */
export async function snapshotDatabase(source: string, destination: string): Promise<void> {
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }
  const copy = new Database(destination, { readonly: true });
  try {
    const result = copy.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error('backup failed its integrity check: ' + String(result));
  } finally {
    copy.close();
  }
}

function tar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error('tar exited ' + code + ': ' + stderr.trim())),
    );
  });
}

/**
 * The nightly backup: pm.db from the backup API, projects.json and uploads/, in
 * one pm-backup-<date>.tar.gz with the same layout the old tar command made, so a
 * restore is still "extract it over an empty data directory".
 */
export async function backupAll(opts: {
  dataDir: string;
  projectsFile: string;
  outDir: string;
  date?: string;
}): Promise<BackupResult> {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  fs.mkdirSync(opts.outDir, { recursive: true });
  const archive = path.resolve(opts.outDir, 'pm-backup-' + date + '.tar.gz');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'officepm-backup-'));
  try {
    const snapshot = path.join(stage, 'pm.db');
    await snapshotDatabase(dbFilePath(opts.dataDir), snapshot);
    const partial = archive + '.partial';
    // -C switches the directory each following name is read from.
    const args = ['-czf', partial, '-C', stage, 'pm.db'];
    if (fs.existsSync(opts.projectsFile)) {
      args.push('-C', path.dirname(opts.projectsFile), path.basename(opts.projectsFile));
    }
    const uploads = path.join(opts.dataDir, 'uploads');
    if (fs.existsSync(uploads)) args.push('-C', opts.dataDir, 'uploads');
    await tar(args);
    // Renamed only once complete, so a half-written file is never taken for a backup.
    fs.renameSync(partial, archive);
    return { archive, dbBytes: fs.statSync(snapshot).size };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
