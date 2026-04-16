#!/usr/bin/env -S node --loader tsx
/**
 * Ingest digested 中台 meta-knowledge into KG.
 * Source: memory/digestions/zhongtai-meta.md (Kuro's digestion, not external)
 *
 * Creates entities + edges from genuine operational experience.
 * Run: pnpm tsx scripts/kg-ingest-zhongtai-meta.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENTITIES_PATH = path.join(ROOT, 'memory/index/entities.jsonl');
const EDGES_PATH = path.join(ROOT, 'memory/index/edges.jsonl');
const CHUNKS_PATH = path.join(ROOT, 'memory/index/chunks.jsonl');

const NOW = new Date().toISOString();
const SOURCE_CHUNK = 'chk-zhongtai-meta-digestion';
const SOURCE_FILE = 'memory/digestions/zhongtai-meta.md';

// Check for duplicate entity IDs
const existingIds = new Set<string>();
for (const line of fs.readFileSync(ENTITIES_PATH, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  try { existingIds.add(JSON.parse(t).id); } catch {}
}

interface Entity {
  id: string;
  type: string;
  subtype?: string;
  canonical_name: string;
  aliases: string[];
  first_seen: string;
  last_referenced: string;
  references: Array<{ chunk_id: string; span?: string; confidence?: number }>;
  meta?: Record<string, unknown>;
}

interface Edge {
  from: string;
  to: string;
  type: string;
  confidence: number;
  weight?: number;
  detector: string;
  evidence_chunk_id: string;
  created: string;
  meta?: Record<string, unknown>;
}

// ============================================================================
// Source chunk — represents the digestion document itself
// ============================================================================
const sourceChunk = {
  id: SOURCE_CHUNK,
  source_file: SOURCE_FILE,
  line_range: [1, 80],
  section_path: ['中台 Meta-Knowledge'],
  type: 'digestion',
  text: 'Kuro 的中台操作經驗消化——架構、踩坑、改進方向、自我幫助',
  text_hash: 'zhongtai-meta-digestion-2026-04-17',
  author: 'kuro',
  extracted_entities: [] as string[],
  created: NOW,
};

// ============================================================================
// Entities — 22 entries from genuine digestion
// ============================================================================
const entities: Entity[] = [
  // --- Project ---
  {
    id: 'ent-zhongtai-middleware',
    type: 'project',
    canonical_name: '中台 (Brain DAG Middleware)',
    aliases: ['中台', 'middleware', 'brain middleware', 'DAG middleware'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: '中台是 mini-agent 的中央協調層', confidence: 0.95 }],
  },

  // --- Concepts (architectural) ---
  {
    id: 'ent-dag-planning',
    type: 'concept',
    canonical_name: 'DAG Planning',
    aliases: ['DAG 規劃', 'goal decomposition', 'task graph'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: '把模糊的目標分解成可追蹤的任務圖', confidence: 0.9 }],
  },
  {
    id: 'ent-bar-loop',
    type: 'concept',
    canonical_name: 'BAR Loop (Brain-Acceptance-Replan)',
    aliases: ['BAR', 'BAR Loop', 'Brain-Acceptance-Replan'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'Brain→Dispatcher→Acceptance，失敗觸發 Replan 回到 Brain', confidence: 0.95 }],
  },
  {
    id: 'ent-acceptance-routing',
    type: 'concept',
    canonical_name: 'Acceptance Routing',
    aliases: ['acceptance verification', 'convergence verification'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: '每個 node 完成時，系統檢查 acceptance condition 是否滿足', confidence: 0.9 }],
  },
  {
    id: 'ent-dispatcher-unification',
    type: 'concept',
    canonical_name: 'Dispatcher Unification',
    aliases: ['unified dispatcher', '統一入口'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'plan 和 delegate 經過同一條 dispatcher 管線', confidence: 0.9 }],
  },
  {
    id: 'ent-commitment-ledger',
    type: 'concept',
    canonical_name: 'Commitment Ledger',
    aliases: ['promise ledger', '承諾追蹤'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: '追蹤「說了什麼」vs「做了什麼」', confidence: 0.9 }],
  },
  {
    id: 'ent-edit-layer-gate',
    type: 'concept',
    canonical_name: 'Edit Layer Gate',
    aliases: ['edit gate', 'proposal edit guard'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'edit-layer gate 守住 proposal 修改', confidence: 0.85 }],
  },
  {
    id: 'ent-feature-gated-rollout',
    type: 'concept',
    canonical_name: 'Feature-gated Rollout',
    aliases: ['feature flag', 'incremental rollout'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: '先量 volume，再接 LLM extraction，最後才開 runtime retrieval', confidence: 0.85 }],
  },
  {
    id: 'ent-single-authority-design',
    type: 'concept',
    canonical_name: 'Single Authority Design',
    aliases: ['single brain', 'no multi-agent consensus'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'Brain 是唯一決策者，不做 multi-agent consensus', confidence: 0.9 }],
  },

  // --- Claims (lessons from experience) ---
  {
    id: 'ent-claim-acceptance-must-be-observable',
    type: 'claim',
    canonical_name: 'Acceptance 條件必須具體可觀察',
    aliases: [],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'acceptance 必須是可機器驗證的斷言', confidence: 0.9 }],
    meta: { truth_value: true, evidence_strength: 'strong', source: 'operational experience' },
  },
  {
    id: 'ent-claim-granularity-overhead',
    type: 'claim',
    canonical_name: '任務粒度過細 → 追蹤 overhead 超過工作本身',
    aliases: [],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: '追蹤的 overhead 超過實際工作', confidence: 0.85 }],
    meta: { truth_value: true, evidence_strength: 'moderate', source: 'task audit cycle #4' },
  },
  {
    id: 'ent-claim-kg-offline-bottleneck',
    type: 'claim',
    canonical_name: 'KG 離線 artifact，缺 runtime retrieval 是瓶頸',
    aliases: [],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'searchMemory() 只走 FTS5，KG 不參與', confidence: 0.95 }],
    meta: { truth_value: true, evidence_strength: 'strong', source: 'kg-internalization proposal audit' },
  },
  {
    id: 'ent-claim-cli-unknown-dominant',
    type: 'claim',
    canonical_name: 'Claude CLI UNKNOWN 是最常見故障模式 (22×)',
    aliases: [],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'CLI 層面的執行失敗。退出碼 N/A', confidence: 0.95 }],
    meta: { truth_value: true, evidence_strength: 'strong', source: 'error log statistics' },
  },
  {
    id: 'ent-claim-structured-thinking-forced',
    type: 'claim',
    canonical_name: 'DAG enforcement 強迫行動前結構化思考',
    aliases: [],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: '以前是想到什麼做什麼，現在是先畫 DAG', confidence: 0.9 }],
    meta: { truth_value: true, evidence_strength: 'moderate', source: 'self-observation' },
  },
  {
    id: 'ent-claim-replan-prevents-false-completion',
    type: 'claim',
    canonical_name: 'Replan 機制防止虛假完成',
    aliases: [],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'BAR 的 replan 機制讓失敗不是終點', confidence: 0.85 }],
    meta: { truth_value: true, evidence_strength: 'moderate', source: 'BAR gap A implementation' },
  },
  {
    id: 'ent-claim-promise-drift-hidden-threat',
    type: 'claim',
    canonical_name: 'Promise drift 是長期運作系統最隱蔽的問題',
    aliases: ['承諾漂移'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'Promise drift 是長期運作系統最隱蔽的問題', confidence: 0.9 }],
    meta: { truth_value: true, evidence_strength: 'moderate', source: 'pattern observation' },
  },

  // --- Decisions ---
  {
    id: 'ent-decision-all-actions-via-dag',
    type: 'decision',
    canonical_name: '所有行為走 DAG (enforcement decision)',
    aliases: ['DAG enforcement'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'dispatcher acceptance gate', confidence: 0.95 }],
    meta: { decided_at: '2026-04-16', authority: 'kuro+cc+akari consensus' },
  },
  {
    id: 'ent-decision-bar-e2e',
    type: 'decision',
    canonical_name: 'BAR 端到端架構 over incremental patches',
    aliases: [],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'Gap A replan loop + Gap B dispatcher unification + Phase 2 acceptance routing + commitment ledger', confidence: 0.9 }],
    meta: { decided_at: '2026-04-16', authority: 'kuro+cc+akari consensus' },
  },
  {
    id: 'ent-decision-three-party-governance',
    type: 'decision',
    canonical_name: '三方共識治理 (Kuro+CC+Akari)',
    aliases: ['three-party consensus'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: '三方共識確認', confidence: 0.85 }],
    meta: { decided_at: '2026-04-16', authority: 'alex (implicit)' },
  },

  // --- Events ---
  {
    id: 'ent-event-bar-landed',
    type: 'event',
    canonical_name: 'BAR 全線完工 (2026-04-16)',
    aliases: [],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'BAR end-to-end 驗證完成，9 scenario types verified', confidence: 0.95 }],
    meta: { date: '2026-04-16', commits: ['1c6ac626', '645635c2', '12833888', 'fd8c51ff', '95913fb4', '543d81ad', 'a5cf65b3'] },
  },

  // --- Code Symbols ---
  {
    id: 'ent-brain-ts',
    type: 'code-symbol',
    canonical_name: 'brain.ts',
    aliases: ['Brain planner'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'Brain（規劃）', confidence: 0.9 }],
    meta: { language: 'typescript', kind: 'module' },
  },
  {
    id: 'ent-delegation-ts',
    type: 'code-symbol',
    canonical_name: 'delegation.ts',
    aliases: [],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'task routing', confidence: 0.9 }],
    meta: { language: 'typescript', kind: 'module' },
  },

  // --- Actor ---
  {
    id: 'ent-akari',
    type: 'actor',
    subtype: 'agent',
    canonical_name: 'Akari',
    aliases: ['Akari designer'],
    first_seen: NOW, last_referenced: NOW,
    references: [{ chunk_id: SOURCE_CHUNK, span: 'Akari designer agent', confidence: 0.9 }],
  },
];

// ============================================================================
// Edges — semantic relationships (not just mentions)
// ============================================================================
const edges: Edge[] = [
  // --- part_of: components of 中台 ---
  { from: 'ent-dag-planning', to: 'ent-zhongtai-middleware', type: 'part_of', confidence: 0.95, weight: 0.8, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-bar-loop', to: 'ent-zhongtai-middleware', type: 'part_of', confidence: 0.95, weight: 0.8, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-acceptance-routing', to: 'ent-zhongtai-middleware', type: 'part_of', confidence: 0.95, weight: 0.8, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-dispatcher-unification', to: 'ent-zhongtai-middleware', type: 'part_of', confidence: 0.95, weight: 0.8, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-commitment-ledger', to: 'ent-zhongtai-middleware', type: 'part_of', confidence: 0.9, weight: 0.7, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-edit-layer-gate', to: 'ent-zhongtai-middleware', type: 'part_of', confidence: 0.85, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-brain-ts', to: 'ent-zhongtai-middleware', type: 'part_of', confidence: 0.95, weight: 0.8, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-dispatcher-ts', to: 'ent-zhongtai-middleware', type: 'part_of', confidence: 0.95, weight: 0.8, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-delegation-ts', to: 'ent-zhongtai-middleware', type: 'part_of', confidence: 0.9, weight: 0.7, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- part_of: BAR sub-concepts ---
  { from: 'ent-acceptance-routing', to: 'ent-bar-loop', type: 'part_of', confidence: 0.9, weight: 0.7, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-dag-planning', to: 'ent-bar-loop', type: 'part_of', confidence: 0.85, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- supports: evidence/argument FOR ---
  { from: 'ent-claim-acceptance-must-be-observable', to: 'ent-acceptance-routing', type: 'supports', confidence: 0.9, weight: 0.7, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-claim-structured-thinking-forced', to: 'ent-dag-planning', type: 'supports', confidence: 0.85, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-claim-replan-prevents-false-completion', to: 'ent-bar-loop', type: 'supports', confidence: 0.85, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-claim-promise-drift-hidden-threat', to: 'ent-commitment-ledger', type: 'supports', confidence: 0.9, weight: 0.7, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-single-authority-design', to: 'ent-zhongtai-middleware', type: 'supports', confidence: 0.85, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-feature-gated-rollout', to: 'ent-zhongtai-middleware', type: 'supports', confidence: 0.8, weight: 0.5, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- contradicts: tensions and problems ---
  { from: 'ent-claim-granularity-overhead', to: 'ent-dag-planning', type: 'contradicts', confidence: 0.8, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-claim-kg-offline-bottleneck', to: 'ent-zhongtai-middleware', type: 'contradicts', confidence: 0.85, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-claim-cli-unknown-dominant', to: 'ent-zhongtai-middleware', type: 'contradicts', confidence: 0.8, weight: 0.5, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- causes: causal chains ---
  { from: 'ent-decision-all-actions-via-dag', to: 'ent-claim-structured-thinking-forced', type: 'causes', confidence: 0.9, weight: 0.7, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-decision-bar-e2e', to: 'ent-event-bar-landed', type: 'causes', confidence: 0.95, weight: 0.8, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- decided_by: authority signatures ---
  { from: 'ent-decision-all-actions-via-dag', to: 'ent-kuro', type: 'decided_by', confidence: 0.9, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-decision-bar-e2e', to: 'ent-kuro', type: 'decided_by', confidence: 0.9, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-decision-three-party-governance', to: 'ent-alex', type: 'decided_by', confidence: 0.85, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- authored_by: who made this ---
  { from: 'ent-zhongtai-middleware', to: 'ent-kuro', type: 'authored_by', confidence: 0.8, weight: 0.5, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-zhongtai-middleware', to: 'ent-claude-code', type: 'authored_by', confidence: 0.8, weight: 0.5, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- instance_of: ISC framework connections ---
  { from: 'ent-single-authority-design', to: 'ent-isc-framework', type: 'instance_of', confidence: 0.8, weight: 0.5, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-acceptance-routing', to: 'ent-constraint-theory', type: 'instance_of', confidence: 0.75, weight: 0.4, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- extends: building on existing concepts ---
  { from: 'ent-commitment-ledger', to: 'ent-commitment-binding', type: 'extends', confidence: 0.85, weight: 0.6, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- references: participants ---
  { from: 'ent-decision-three-party-governance', to: 'ent-kuro', type: 'references', confidence: 0.9, weight: 0.5, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-decision-three-party-governance', to: 'ent-claude-code', type: 'references', confidence: 0.9, weight: 0.5, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },
  { from: 'ent-decision-three-party-governance', to: 'ent-akari', type: 'references', confidence: 0.9, weight: 0.5, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW },

  // --- analogy_to: structural similarities ---
  { from: 'ent-bar-loop', to: 'ent-isc-framework', type: 'analogy_to', confidence: 0.75, weight: 0.4, detector: 'manual-digestion', evidence_chunk_id: SOURCE_CHUNK, created: NOW, meta: { note: 'BAR is constraint-driven feedback loop; ISC views constraints as productive forces' } },
];

// ============================================================================
// Deduplicate and append
// ============================================================================
let newEntities = 0;
let skippedEntities = 0;
let newEdges = 0;

for (const ent of entities) {
  if (existingIds.has(ent.id)) {
    console.log(`SKIP (exists): ${ent.id}`);
    skippedEntities++;
    continue;
  }
  fs.appendFileSync(ENTITIES_PATH, JSON.stringify(ent) + '\n');
  existingIds.add(ent.id);
  newEntities++;
  sourceChunk.extracted_entities.push(ent.id);
}

// Append source chunk
fs.appendFileSync(CHUNKS_PATH, JSON.stringify(sourceChunk) + '\n');

// Append edges (check for dupes by from+to+type)
const existingEdgeKeys = new Set<string>();
for (const line of fs.readFileSync(EDGES_PATH, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  try {
    const e = JSON.parse(t);
    existingEdgeKeys.add(`${e.from}|${e.to}|${e.type}`);
  } catch {}
}

for (const edge of edges) {
  const key = `${edge.from}|${edge.to}|${edge.type}`;
  if (existingEdgeKeys.has(key)) {
    console.log(`SKIP edge (exists): ${key}`);
    continue;
  }
  // Verify both entities exist
  if (!existingIds.has(edge.from) || !existingIds.has(edge.to)) {
    console.log(`SKIP edge (missing entity): ${edge.from} → ${edge.to}`);
    continue;
  }
  fs.appendFileSync(EDGES_PATH, JSON.stringify(edge) + '\n');
  existingEdgeKeys.add(key);
  newEdges++;
}

// Update manifest
const manifestPath = path.join(ROOT, 'memory/index/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
manifest.entities_count = existingIds.size;
manifest.edges_count = existingEdgeKeys.size;
manifest.last_incremental = NOW;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`\n=== Zhongtai Meta-KG Ingest ===`);
console.log(`New entities: ${newEntities} (skipped ${skippedEntities} existing)`);
console.log(`New edges: ${newEdges}`);
console.log(`Total entities: ${existingIds.size}`);
console.log(`Total edges: ${existingEdgeKeys.size}`);
console.log(`Manifest updated.`);
console.log(`\nNext: pnpm tsx scripts/kg-viz.ts  (rebuild visualization)`);
