/**
 * Memory Layer v3 — Entry Store
 *
 * Append-only JSONL store for content-atom entries compiled from raw memory.
 * See memory/proposals/2026-04-14-memory-layer-v3.md
 *
 * Invariants (enforced):
 *   1. Immutability — entries.jsonl is append-only; no in-place edits
 *   2. Dedup by content_hash — duplicate writes return null (no error)
 *   3. Attribution non-empty — writer rejects blank attribution
 *   4. stale_reason required when supersedes is non-empty
 *   5. Circular supersede detection — A→B→A rejected at write time
 *   6. Supersede target must exist — unknown target rejected
 *
 * Exclusion mechanism:
 *   <kuro:exclude target="entry-xxx">reason</kuro:exclude>
 *   → appends to exclusions.jsonl (separate file)
 *   → readers filter excluded entries from views
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Entry, EntryType, EntryExclusion } from './types.js';

// ── helpers ──────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function computeContentHash(content: string): string {
  return 'sha256:' + sha256Hex(content.trim()).slice(0, 32);
}

export function generateEntryId(): string {
  return 'entry-' + crypto.randomBytes(8).toString('hex');
}

// ── public API ───────────────────────────────────────────────────────

export interface WriteEntryInput {
  content: string;
  source: string;
  concepts?: string[];
  type?: EntryType;
  supersedes?: string[];
  stale_reason?: string | null;
  attribution: string;
}

export interface EntryStats {
  total: number;
  active: number;          // total - superseded - excluded
  superseded: number;
  excluded: number;
  byType: Record<EntryType, number>;
  byAttribution: Record<string, number>;
  latestCreatedAt: string | null;
}

export class EntriesStore {
  private filePath: string;
  private exclusionsPath: string;
  private entries: Entry[] = [];
  private byHash = new Map<string, Entry>();
  private byId = new Map<string, Entry>();
  private exclusions = new Map<string, EntryExclusion>();

  constructor(memoryDir: string) {
    const indexDir = path.join(memoryDir, 'index');
    this.filePath = path.join(indexDir, 'entries.jsonl');
    this.exclusionsPath = path.join(indexDir, 'exclusions.jsonl');
    fs.mkdirSync(indexDir, { recursive: true });
    this.reload();
  }

  /** Reload in-memory state from disk. Call after external writes. */
  reload(): void {
    this.entries = [];
    this.byHash.clear();
    this.byId.clear();
    this.exclusions.clear();

    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Entry;
          this.entries.push(entry);
          this.byHash.set(entry.content_hash, entry);
          this.byId.set(entry.id, entry);
        } catch {
          // Skip malformed line. Writer round-trip test prevents escape bugs,
          // but stay tolerant on read per spec ("malformed line skip + log").
          // eslint-disable-next-line no-console
          console.warn(`[entries] skipped malformed line in ${this.filePath}`);
        }
      }
    }

    if (fs.existsSync(this.exclusionsPath)) {
      const raw = fs.readFileSync(this.exclusionsPath, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const ex = JSON.parse(line) as EntryExclusion;
          this.exclusions.set(ex.target, ex);
        } catch {
          // ignore
        }
      }
    }

    // Derive superseded_by (in-memory only; not persisted per immutability)
    for (const e of this.entries) {
      if (e.supersedes && e.supersedes.length > 0) {
        for (const t of e.supersedes) {
          const target = this.byId.get(t);
          if (target) target.superseded_by = e.id;
        }
      }
    }
  }

  /**
   * Append a new entry. Enforces all invariants.
   * Returns the created Entry, or null if content_hash already exists (dedup).
   * Throws on invariant violation (attribution, stale_reason, circular, missing target).
   */
  append(input: WriteEntryInput): Entry | null {
    if (!input.attribution || !input.attribution.trim()) {
      throw new Error('entry.attribution must be non-empty');
    }
    if (typeof input.content !== 'string' || !input.content.trim()) {
      throw new Error('entry.content must be non-empty');
    }

    const hash = computeContentHash(input.content);
    if (this.byHash.has(hash)) {
      return null; // dedup hit
    }

    const supersedes = (input.supersedes ?? []).filter(Boolean);
    for (const t of supersedes) {
      if (!this.byId.has(t)) {
        throw new Error(`supersede target not found: ${t}`);
      }
    }

    if (supersedes.length > 0) {
      const reason = (input.stale_reason ?? '').trim();
      if (!reason) {
        throw new Error('stale_reason required when supersedes is non-empty');
      }
    }

    const id = generateEntryId();
    if (this.detectCircular(supersedes, id)) {
      throw new Error('circular supersede detected');
    }

    const now = new Date().toISOString();
    const entry: Entry = {
      id,
      source: input.source,
      content_hash: hash,
      content: input.content,
      concepts: input.concepts ?? [],
      type: input.type ?? 'fact',
      created_at: now,
      last_validated_at: now,
      confidence: 1.0,
      supersedes,
      superseded_by: null,
      stale_reason: supersedes.length > 0 ? (input.stale_reason ?? null) : null,
      attribution: input.attribution,
    };

    // Writer-side round-trip test (per Kuro #067 — defends against escape bugs)
    const serialized = JSON.stringify(entry);
    try {
      const round = JSON.parse(serialized) as Entry;
      if (round.id !== entry.id || round.content_hash !== entry.content_hash) {
        throw new Error('round-trip mismatch (id or hash)');
      }
      if (round.content !== entry.content) {
        throw new Error('round-trip mismatch (content)');
      }
    } catch (e) {
      throw new Error(`serialization round-trip failed: ${(e as Error).message}`);
    }

    fs.appendFileSync(this.filePath, serialized + '\n');

    this.entries.push(entry);
    this.byHash.set(hash, entry);
    this.byId.set(id, entry);

    // Update in-memory superseded_by (not persisted)
    for (const t of supersedes) {
      const target = this.byId.get(t);
      if (target) target.superseded_by = id;
    }

    return entry;
  }

  /** Append an exclusion marker. Separate file — does not mutate entries. */
  exclude(target: string, reason: string, attribution: string): EntryExclusion {
    if (!this.byId.has(target)) {
      throw new Error(`exclude target not found: ${target}`);
    }
    const trimmedReason = (reason ?? '').trim();
    if (!trimmedReason) {
      throw new Error('exclude reason must be non-empty');
    }
    const trimmedAttr = (attribution ?? '').trim();
    if (!trimmedAttr) {
      throw new Error('exclude attribution must be non-empty');
    }
    const ex: EntryExclusion = {
      target,
      reason: trimmedReason,
      attribution: trimmedAttr,
      ts: new Date().toISOString(),
    };
    fs.appendFileSync(this.exclusionsPath, JSON.stringify(ex) + '\n');
    this.exclusions.set(target, ex);
    return ex;
  }

  /** Append a validation marker (refreshes last_validated_at via sidecar). */
  validate(target: string, attribution: string): void {
    const entry = this.byId.get(target);
    if (!entry) throw new Error(`validate target not found: ${target}`);
    const ts = new Date().toISOString();
    const record = { op: 'validate', target, attribution, ts };
    const validatePath = path.join(path.dirname(this.filePath), 'validations.jsonl');
    fs.appendFileSync(validatePath, JSON.stringify(record) + '\n');
    // In-memory refresh (view-layer; not persisted in entry itself)
    entry.last_validated_at = ts;
  }

  // ── queries ────────────────────────────────────────────────────────

  findById(id: string): Entry | null {
    return this.byId.get(id) ?? null;
  }

  findByHash(hash: string): Entry | null {
    return this.byHash.get(hash) ?? null;
  }

  findByConcept(concept: string): Entry[] {
    return this.entries.filter(e => e.concepts.includes(concept));
  }

  isExcluded(id: string): boolean {
    return this.exclusions.has(id);
  }

  /** All entries, including superseded/excluded. Caller filters as needed. */
  all(): Entry[] {
    return this.entries.slice();
  }

  /** Active entries: not superseded, not excluded. */
  active(): Entry[] {
    return this.entries.filter(e => !e.superseded_by && !this.isExcluded(e.id));
  }

  getStats(): EntryStats {
    const byType: Record<EntryType, number> = { fact: 0, decision: 0, pattern: 0, reference: 0 };
    const byAttribution: Record<string, number> = {};
    let superseded = 0;
    let latest: string | null = null;

    for (const e of this.entries) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      byAttribution[e.attribution] = (byAttribution[e.attribution] ?? 0) + 1;
      if (e.superseded_by) superseded++;
      if (!latest || e.created_at > latest) latest = e.created_at;
    }
    const excluded = this.exclusions.size;
    return {
      total: this.entries.length,
      active: this.entries.length - superseded - excluded,
      superseded,
      excluded,
      byType,
      byAttribution,
      latestCreatedAt: latest,
    };
  }

  // ── internals ──────────────────────────────────────────────────────

  private detectCircular(candidateSupersedes: string[], newId: string): boolean {
    // Walk from each candidate target upward via superseded_by: if any leads
    // to a node whose superseded_by would point to newId (i.e. newId is already
    // in the chain downstream), it's circular.
    //
    // Simpler check (entry is new so no incoming edges yet): walk upward through
    // targets' existing supersedes chains. Cycles in prior data shouldn't block
    // new writes, but we refuse to participate in one.
    for (const target of candidateSupersedes) {
      const visited = new Set<string>();
      let cur: Entry | undefined = this.byId.get(target);
      while (cur) {
        if (visited.has(cur.id)) return true; // pre-existing cycle
        visited.add(cur.id);
        if (cur.id === newId) return true;     // should never happen (new id)
        // Move up the chain: look at what supersedes cur (newer)
        if (cur.superseded_by) {
          cur = this.byId.get(cur.superseded_by);
        } else {
          break;
        }
      }
    }
    return false;
  }
}

// ── lazy singleton ───────────────────────────────────────────────────

let _store: EntriesStore | undefined;
let _memoryDir: string | undefined;

export function getEntriesStore(memoryDir: string): EntriesStore {
  if (!_store || _memoryDir !== memoryDir) {
    _store = new EntriesStore(memoryDir);
    _memoryDir = memoryDir;
  }
  return _store;
}

export function resetEntriesStore(): void {
  _store = undefined;
  _memoryDir = undefined;
}
