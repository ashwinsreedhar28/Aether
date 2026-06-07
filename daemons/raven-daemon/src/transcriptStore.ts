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
 *   - Bounded: on boot and on each new session we prune the oldest session
 *     files beyond a cap (default 50, override RAVEN_TRANSCRIPT_MAX_SESSIONS) so
 *     the dir doesn't grow without bound across reboots. The live session file
 *     is never pruned. We cap by file count, not bytes: one file per child
 *     spawn is the realistic growth vector, so a count cap bounds it predictably
 *     and is trivial to reason about. A byte cap (for a single pathologically
 *     large session) is a later lane if that ever shows up.
 *   - Filenames are epoch-prefixed so a lexical directory sort is chronological
 *     (epoch-ms is fixed-width through year 2286 — fine for our purposes).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TranscriptEntry } from './types';

const SUBDIR = 'transcripts';

// Marker substituted for the spawn passphrase wherever it appears in transcript
// text. The phrase must be unretrievable from stored transcripts — the eventual
// RAG corpus will index them — so it is scrubbed at the persist chokepoint
// (append, below) AND before the daemon rings/broadcasts an entry (recordTranscript
// in ravenManager). See the spawn-actor ADR in DECISIONS.md.
const REDACTED = '[REDACTED]';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scrub the spawn passphrase (AETHER_SPAWN_PHRASE) from a transcript line —
 * exact and case-insensitive, every occurrence, in BOTH speaker roles. No-op
 * when the env var is unset/empty (a blank phrase would otherwise match
 * everywhere). Read from process.env at call time: the value is fixed for the
 * process lifetime and transcripts are low-frequency, so re-reading is free.
 */
export function redactSecrets(text: string): string {
  const phrase = process.env.AETHER_SPAWN_PHRASE;
  if (!phrase || !text) return text;
  return text.replace(new RegExp(escapeRegExp(phrase), 'gi'), REDACTED);
}

// Keep at most this many session files on disk; oldest beyond it are pruned.
// 50 is generous for week-1 single-user use while bounding the dir across
// reboots. Override with RAVEN_TRANSCRIPT_MAX_SESSIONS (positive integer).
const DEFAULT_MAX_SESSIONS = 50;

export class TranscriptStore {
  private dir: string;
  private currentFile: string | null = null;
  private maxSessions: number;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, SUBDIR);
    const envMax = parseInt(process.env.RAVEN_TRANSCRIPT_MAX_SESSIONS || '', 10);
    this.maxSessions = Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_SESSIONS;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      console.error('[transcriptStore] mkdir failed:', err);
    }
    // Boot-time prune: no session is open yet, so nothing is protected as live —
    // this bounds the dir left over from prior runs before history is read back.
    this.prune();
  }

  /**
   * Begin a new session file. Called on each child spawn. The epoch prefix
   * keeps a lexical directory sort chronological; the short session-id suffix
   * disambiguates two spawns that land in the same millisecond.
   */
  openSession(sessionId: string): void {
    const stamp = Date.now();
    this.currentFile = path.join(this.dir, `session-${stamp}-${sessionId.slice(0, 8)}.jsonl`);
    // Prune again so a long-lived daemon (many start/stop cycles in one process)
    // stays bounded, not just at boot. The file we just named isn't on disk yet
    // and is the newest anyway, so it is never a prune target; the guard in
    // prune() additionally protects it once it has content.
    this.prune();
  }

  /**
   * Bound the transcripts dir to the most-recent `maxSessions` files, deleting
   * the oldest beyond that. Best-effort: a failure logs and leaves files in
   * place rather than throwing. Never deletes the current live session file.
   */
  prune(): void {
    let files: string[];
    try {
      files = fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort(); // epoch-prefixed → lexical sort is chronological (oldest first)
    } catch {
      return;
    }

    const excess = files.length - this.maxSessions;
    if (excess <= 0) return;

    const liveName = this.currentFile ? path.basename(this.currentFile) : null;
    let removed = 0;
    // Delete oldest-first until back within the cap, skipping the live session.
    for (const f of files) {
      if (removed >= excess) break;
      if (f === liveName) continue;
      try {
        fs.unlinkSync(path.join(this.dir, f));
        removed++;
      } catch (err) {
        console.error('[transcriptStore] prune unlink failed:', err);
      }
    }
  }

  /**
   * Append one entry to the current session file. No-op before openSession.
   * Scrubs the spawn passphrase before writing so the stored (RAG-indexable)
   * transcript can never carry it — this is the authoritative persist-time
   * chokepoint, independent of any upstream redaction (idempotent if already
   * scrubbed).
   */
  append(entry: TranscriptEntry): void {
    if (!this.currentFile) return;
    const safe = { ...entry, text: redactSecrets(entry.text) };
    try {
      fs.appendFileSync(this.currentFile, JSON.stringify(safe) + '\n');
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
