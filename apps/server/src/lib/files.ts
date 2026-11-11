import fs from 'node:fs';

/** Deletes a file, ignoring one that is already gone (v1 did the same). */
export function unlinkQuietly(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // already gone
  }
}
