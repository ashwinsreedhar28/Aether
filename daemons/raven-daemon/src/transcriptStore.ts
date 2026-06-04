/**
 * Transcript Store — durable tail for the in-memory transcript ring.
 *
 * Persists transcript entries as JSONL (one JSON object per line), one file per
 * session, under <dataDir>/transcripts/. The daemon keeps its in-memory ring as
 * the hot path; this store is the part that survives a restart. On boot the
 * daemon asks for the most-recent entries back so the Chats view has history
 * immediately, before any new turn happens.
 *
 * Design notes (week-1 restraint):
 *   - Best-effort: a write or read failure logs and degrades to a smaller (or
 *     empty) result; it never throws into the transcript hot path.
 *   - No pruning. Session files accumulate; bounding disk use is a later lane
 *     (flagged in the PR). We never delete user data on this path.
 *   - Filenames are epoch-prefixed so a lexical directory sort is chronological
 *     (epoch-ms is fixed-width through year 2286 — fine for our purposes).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TranscriptEntry } from './types';

const SUBDIR = 'transcripts';

export class TranscriptStore {
  private dir: string;
  private currentFile: string | null = null;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, SUBDIR);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      console.error('[transcriptStore] mkdir failed:', err);
    }
  }

  /**
   * Begin a new session file. Called on each child spawn. The epoch prefix
   * keeps a lexical directory sort chronological; the short session-id suffix
   * disambiguates two spawns that land in the same millisecond.
   */
  openSession(sessionId: string): void {
    const stamp = Date.now();
    this.currentFile = path.join(this.dir, `session-${stamp}-${sessionId.slice(0, 8)}.jsonl`);
  }

  /** Append one entry to the current session file. No-op before openSession. */
  append(entry: TranscriptEntry): void {
    if (!this.currentFile) return;
    try {
      fs.appendFileSync(this.currentFile, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error('[transcriptStore] append failed:', err);
    }
  }

  /**
   * Load up to `max` most-recent entries across the most-recent session files,
   * returned oldest-first so they can seed the ring in order. Walks newest file
   * first and stops once it has enough, so a long history doesn't force reading
   * every file on boot.
   */
  loadRecent(max: number): TranscriptEntry[] {
    let files: string[];
    try {
      files = fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort();
    } catch {
      return [];
    }

    const entries: TranscriptEntry[] = [];
    // Newest file first; unshift each older file's entries ahead of what we
    // have so the final array stays chronological (older sessions first).
    for (let i = files.length - 1; i >= 0 && entries.length < max; i--) {
      const filePath = path.join(this.dir, files[i] as string);
      entries.unshift(...this.readFileEntries(filePath));
    }

    // We may have overshot on the oldest file read; keep the newest `max`.
    return entries.slice(-max);
  }

  private readFileEntries(filePath: string): TranscriptEntry[] {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      return [];
    }
    const out: TranscriptEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as TranscriptEntry);
      } catch {
        // Skip a corrupt line (partial write on a hard crash) and keep the rest.
      }
    }
    return out;
  }
}
