import fs from 'node:fs';
import path from 'node:path';

// v1 stored the ABSOLUTE path multer wrote, e.g.
//   /srv/officepm/uploads/tickets/FOOD-ENG-4/3f2a....png
// so a database copied to another machine or directory points at files that are
// no longer there. v2 keeps those rows untouched (rewriting them would break a
// rollback to v1) and instead resolves them at read time against the CURRENT
// data directory. Files are only ever written as uploads/<kind>/<id>/<file>, so
// the last four segments are enough to find a file again.
const KINDS = new Set(['projects', 'tickets']);

function isPlainSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\0');
}

/**
 * Maps a `stored_path` from project_files/ticket_files to the real file under
 * `<dataDir>/uploads`, or returns null. The result is always inside that
 * directory: the stored path is used only to extract its
 * `uploads/(projects|tickets)/<id>/<file>` tail, which is re-joined onto the
 * current directory. Even a stored path that exists elsewhere is never returned.
 * Rejects `..` segments and NUL bytes, and refuses symlinks that lead out.
 */
export function resolveStoredPath(dataDir: string, storedPath: string): string | null {
  if (typeof storedPath !== 'string' || storedPath === '' || storedPath.includes('\0')) return null;

  // Split on both separators so a path written on Windows still re-roots.
  const segments = storedPath.split(/[\\/]/);
  if (segments.includes('..')) return null;

  const tail = segments.slice(-4);
  if (tail.length < 4) return null;
  const [uploads, kind, id, file] = tail as [string, string, string, string];
  if (uploads !== 'uploads' || !KINDS.has(kind) || !isPlainSegment(id) || !isPlainSegment(file)) {
    return null;
  }

  const root = path.resolve(dataDir, 'uploads');
  const candidate = path.join(root, kind, id, file);
  // Belt and braces, the same check v1's assertInsideUploads makes.
  if (!path.resolve(candidate).startsWith(root + path.sep)) return null;

  try {
    const real = fs.realpathSync(candidate);
    if (!real.startsWith(fs.realpathSync(root) + path.sep)) return null;
    return fs.statSync(real).isFile() ? candidate : null;
  } catch {
    return null; // missing, or not readable
  }
}
