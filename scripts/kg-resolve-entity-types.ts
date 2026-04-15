#!/usr/bin/env tsx
// KG Entity Type Resolver — overlay tool
// Applies R1-R6 rules from memory/proposals/2026-04-15-kg-type-resolver-rules-draft.md
// Reads:  memory/index/entities.jsonl + memory/index/conflicts.jsonl
// Writes: memory/index/entities-resolved.jsonl (superset of entities.jsonl)
//         memory/index/resolution-audit.jsonl (per-resolution trail)
// Raw entities.jsonl is NOT modified.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Entity = {
  id: string;
  type: string;
  canonical_name?: string;
  aliases?: string[];
  [k: string]: unknown;
};

type Conflict = {
  id: string;
  type: 'type_conflict' | string;
  entities: string[];
  resolution: string;
};

type Rule = 'R0-noop' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7-needs-review';
type Confidence = 'high' | 'medium' | 'low';

type Resolution = {
  rule: Rule;
  resolved_type: string | string[];
  alternatives: string[];
  confidence: Confidence;
  evidence: string;
};

const ROOT = resolve(process.cwd());
const ENTITIES_PATH = resolve(ROOT, 'memory/index/entities.jsonl');
const CONFLICTS_PATH = resolve(ROOT, 'memory/index/conflicts.jsonl');
const OUT_RESOLVED = resolve(ROOT, 'memory/index/entities-resolved.jsonl');
const OUT_AUDIT = resolve(ROOT, 'memory/index/resolution-audit.jsonl');

const readJsonl = <T>(p: string): T[] =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

// "competing types: registered=decision, disputed=concept" → ["decision","concept"]
const parseCandidates = (resolution: string): string[] => {
  const m = resolution.match(/registered=([\w-]+),\s*disputed=([\w-]+)/);
  return m ? [m[1], m[2]] : [];
};

const FILE_EXT_CODE = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.sh', '.py']);
const FILE_EXT_ARTIFACT = new Set(['.json', '.jsonl', '.md', '.db', '.html', '.yaml', '.yml']);
const extOf = (name: string): string => {
  const m = name.match(/(\.[a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
};

// PascalCase phrase detector (no extension, multi-word Title/Pascal)
const looksLikeFeatureName = (name: string): boolean => {
  if (extOf(name)) return false;
  // "Achievement System", "Output Gate", "AchievementSystem", "OutputGate"
  if (/^[A-Z][a-z]+([A-Z][a-z]+)+$/.test(name)) return true; // PascalCase
  if (/^[A-Z][a-z]+(\s[A-Z][a-z]+)+$/.test(name)) return true; // Title Case multi-word
  return false;
};

const isAllCapsLabel = (name: string): boolean =>
  !extOf(name) && /^[A-Z_]{3,}$/.test(name);

const applyRules = (ent: Entity, candidates: string[]): Resolution => {
  const set = new Set(candidates);
  const name = (ent.canonical_name ?? ent.id).trim();
  const ext = extOf(name) || extOf(ent.id);

  // R1 — decision > concept
  if (set.has('decision') && set.has('concept')) {
    return {
      rule: 'R1',
      resolved_type: 'decision',
      alternatives: ['concept'],
      confidence: 'high',
      evidence: `decision is primary (first declaration + reasoning); concept is abstract ref`,
    };
  }

  // R2 — File extension inference (code-symbol vs artifact)
  if (set.has('code-symbol') && set.has('artifact')) {
    if (FILE_EXT_CODE.has(ext)) {
      return {
        rule: 'R2',
        resolved_type: 'code-symbol',
        alternatives: ['artifact'],
        confidence: 'high',
        evidence: `ext=${ext} → source code`,
      };
    }
    if (FILE_EXT_ARTIFACT.has(ext)) {
      return {
        rule: 'R2',
        resolved_type: 'artifact',
        alternatives: ['code-symbol'],
        confidence: 'high',
        evidence: `ext=${ext} → runtime/curated artifact`,
      };
    }
    if (isAllCapsLabel(name)) {
      return {
        rule: 'R2',
        resolved_type: 'artifact',
        alternatives: ['code-symbol'],
        confidence: 'medium',
        evidence: `all-caps no-ext label → runtime state label`,
      };
    }
    // Fallthrough — R2 applicable but no extension signal
    return {
      rule: 'R7-needs-review',
      resolved_type: candidates[0],
      alternatives: candidates.slice(1),
      confidence: 'low',
      evidence: `R2 candidate but no ext/caps signal: name="${name}"`,
    };
  }

  // R3 — PascalCase feature name → concept (code-symbol vs concept)
  if (set.has('code-symbol') && set.has('concept')) {
    if (looksLikeFeatureName(name)) {
      return {
        rule: 'R3',
        resolved_type: 'concept',
        alternatives: ['code-symbol'],
        confidence: 'high',
        evidence: `PascalCase/Title feature name "${name}" → subsystem concept`,
      };
    }
    // lowercase kebab-case without extension — ambiguous, default concept (bias toward abstract when no ext)
    if (!ext) {
      return {
        rule: 'R3',
        resolved_type: 'concept',
        alternatives: ['code-symbol'],
        confidence: 'medium',
        evidence: `no-ext label, no PascalCase signal → default concept`,
      };
    }
    return {
      rule: 'R7-needs-review',
      resolved_type: candidates[0],
      alternatives: candidates.slice(1),
      confidence: 'low',
      evidence: `R3 candidate but unclear: name="${name}" ext="${ext}"`,
    };
  }

  // R4 — Union for tool+actor / artifact+actor
  if (set.has('actor') && (set.has('tool') || set.has('artifact'))) {
    const other = set.has('tool') ? 'tool' : 'artifact';
    return {
      rule: 'R4',
      resolved_type: [other, 'actor'],
      alternatives: [],
      confidence: 'high',
      evidence: `dual-role entity: both ${other} and actor`,
    };
  }

  // R5 — project + tool → project (tool is output)
  if (set.has('project') && set.has('tool')) {
    return {
      rule: 'R5',
      resolved_type: 'project',
      alternatives: ['tool'],
      confidence: 'high',
      evidence: `project wraps tool output`,
    };
  }

  // R6 — concept + tool w/o implementation → concept
  if (set.has('concept') && set.has('tool')) {
    return {
      rule: 'R6',
      resolved_type: 'concept',
      alternatives: ['tool'],
      confidence: 'medium',
      evidence: `technical category (implementation-free) → concept`,
    };
  }

  // Fallback
  return {
    rule: 'R7-needs-review',
    resolved_type: candidates[0] ?? (ent.type as string),
    alternatives: candidates.slice(1),
    confidence: 'low',
    evidence: `no rule matched: candidates=[${candidates.join(', ')}]`,
  };
};

const main = () => {
  const entities = readJsonl<Entity>(ENTITIES_PATH);
  const conflicts = readJsonl<Conflict>(CONFLICTS_PATH).filter((c) => c.type === 'type_conflict');

  const conflictByEntityId = new Map<string, Conflict>();
  for (const c of conflicts) {
    for (const eid of c.entities) conflictByEntityId.set(eid, c);
  }

  const resolvedLines: string[] = [];
  const auditLines: string[] = [];
  const ruleCount: Record<string, number> = {};
  const confCount: Record<string, number> = {};

  for (const ent of entities) {
    const conflict = conflictByEntityId.get(ent.id);
    let res: Resolution;

    if (!conflict) {
      res = {
        rule: 'R0-noop',
        resolved_type: ent.type,
        alternatives: [],
        confidence: 'high',
        evidence: 'no conflict — passthrough',
      };
    } else {
      const candidates = parseCandidates(conflict.resolution);
      res = applyRules(ent, candidates);
      auditLines.push(
        JSON.stringify({
          entity_id: ent.id,
          conflict_id: conflict.id,
          canonical_name: ent.canonical_name,
          before: { registered: ent.type, candidates },
          after: { resolved_type: res.resolved_type, rule: res.rule, confidence: res.confidence },
          evidence: res.evidence,
          resolved_at: new Date().toISOString(),
        }),
      );
    }

    ruleCount[res.rule] = (ruleCount[res.rule] ?? 0) + 1;
    confCount[res.confidence] = (confCount[res.confidence] ?? 0) + 1;

    resolvedLines.push(
      JSON.stringify({
        ...ent,
        resolved_type: res.resolved_type,
        resolution_rule: res.rule,
        resolution_confidence: res.confidence,
        alternatives: res.alternatives,
      }),
    );
  }

  writeFileSync(OUT_RESOLVED, resolvedLines.join('\n') + '\n');
  writeFileSync(OUT_AUDIT, auditLines.join('\n') + (auditLines.length ? '\n' : ''));

  console.log(`entities.jsonl:           ${entities.length}`);
  console.log(`conflicts.jsonl (type):   ${conflicts.length}`);
  console.log(`entities-resolved.jsonl:  ${resolvedLines.length}`);
  console.log(`resolution-audit.jsonl:   ${auditLines.length}`);
  console.log(`\nRule distribution:`);
  for (const [rule, n] of Object.entries(ruleCount).sort()) {
    console.log(`  ${rule.padEnd(18)} ${n}`);
  }
  console.log(`\nConfidence distribution:`);
  for (const [c, n] of Object.entries(confCount).sort()) {
    console.log(`  ${c.padEnd(18)} ${n}`);
  }

  const unresolved = auditLines.filter((l) => l.includes('"rule":"R7-needs-review"')).length;
  if (unresolved > 0) {
    console.log(`\n⚠️  ${unresolved} conflict(s) needs-review (R7). See resolution-audit.jsonl.`);
    process.exitCode = 2;
  }
};

main();
