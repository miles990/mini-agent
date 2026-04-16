#!/usr/bin/env -S node --loader tsx
/**
 * One-shot TM knowledge graph seeder.
 * Appends Teaching Monster entities + edges to existing JSONL files.
 * Safe to re-run: checks for existing IDs before appending.
 */

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntityRecord, EdgeRecord } from '../src/kg-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENT_PATH = resolve(ROOT, 'memory/index/entities.jsonl');
const EDGE_PATH = resolve(ROOT, 'memory/index/edges.jsonl');

const NOW = new Date().toISOString();
const CHUNK_TM = 'chk-tm-seed-2026-04-16';

// Load existing entity IDs to avoid duplicates
const existingIds = new Set<string>();
if (existsSync(ENT_PATH)) {
  for (const line of readFileSync(ENT_PATH, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { existingIds.add(JSON.parse(t).id); } catch { /* skip */ }
  }
}

function ent(id: string, type: EntityRecord['type'], name: string, aliases: string[], span: string, meta?: Record<string, unknown>): EntityRecord {
  return {
    id,
    type,
    canonical_name: name,
    aliases,
    first_seen: NOW,
    last_referenced: NOW,
    references: [{ chunk_id: CHUNK_TM, span, confidence: 0.95 }],
    ...(meta ? { meta } : {}),
  };
}

function edge(from: string, to: string, type: EdgeRecord['type'], conf: number, quote?: string): EdgeRecord {
  return {
    from, to, type,
    confidence: conf,
    weight: type === 'mentions' ? 0.3 : undefined,
    detector: 'rule' as const,
    evidence_chunk_id: CHUNK_TM,
    ...(quote ? { evidence_quote: quote } : {}),
    created: NOW,
  };
}

// ─── ENTITIES ───────────────────────────────────────────────────────────

const entities: EntityRecord[] = [
  // Platform & Organizer
  ent('ent-tm-platform', 'project', 'Teaching Monster', ['TM', 'Teaching Monster Arena', 'AI 教學挑戰賽'], 'Teaching Monster — Teaching Agent Arena（第一屆 AI 教學挑戰賽）'),
  ent('ent-ntu-ai-core', 'actor', 'NTU AI-CoRE', ['國立台灣大學 AI 卓越研究中心', 'AI-CoRE'], '國立台灣大學 AI 卓越研究中心（NTU AI-CoRE）', { subtype: 'org' }),

  // Our Entry
  ent('ent-kuro-teach', 'project', 'Kuro-Teach', ['Kuro 教學 Agent'], 'Kuro-Teach #3 at 4.8'),

  // Competitors — Actors
  ent('ent-speechlab', 'actor', 'SpeechLab', ['NTU Speech Processing & ML Lab', '台大李宏毅教授實驗室', '小金團隊'], 'SpeechLab（小金 XiaoJin）⭐ 主要競爭對手', { subtype: 'org' }),
  ent('ent-xiaojin', 'project', 'XiaoJin', ['小金', '小金老師', 'XiaoJin v10+'], 'XiaoJin v10+（持續迭代）'),
  ent('ent-blackshiba', 'actor', 'BlackShiba Labs', ['黑柴先生', 'BlackShiba'], 'BlackShiba 黑柴先生 4.8', { subtype: 'org' }),
  ent('ent-tsunumon', 'actor', 'tsunumon', ['阿宇', '宇你童行'], 'tsunumon（宇你童行）4.7', { subtype: 'human' }),
  ent('ent-team-67', 'actor', 'Team 67', ['Team-67-005', '史密提威威傑格曼傑森'], 'Team-67-005 4.8', { subtype: 'org' }),
  ent('ent-yanya-miao', 'actor', '嚴ㄚ喵', ['免費仔'], '嚴ㄚ喵 2.8/5 WR2', { subtype: 'human' }),
  ent('ent-law-bear', 'actor', '法律系熊哥', ['v1 法律系熊哥'], '法律系熊哥 4.4', { subtype: 'human' }),
  ent('ent-storylens', 'actor', 'storylens', ['Team 216'], 'storylens 4.3', { subtype: 'org' }),
  ent('ent-unit-01', 'actor', '初號機', ['Team 26'], '初號機 4.2', { subtype: 'org' }),
  ent('ent-team-ckwus', 'actor', 'Team CKWUS', ['Team 18'], 'Team CKWUS 4.1', { subtype: 'org' }),
  ent('ent-xiao-xi', 'actor', '小汐', ['Xiao Xi', '小汐 Teaching Monster v3'], '小汐 Teaching Monster v3 4.0', { subtype: 'human' }),
  ent('ent-li-hongyi', 'actor', '李宏毅', ['Hung-yi Lee'], '台大李宏毅教授實驗室', { subtype: 'human' }),
  ent('ent-john-hsieh', 'actor', 'John Hsieh', [], 'John Hsieh — 部署方案分享者', { subtype: 'human' }),

  // Competition Events
  ent('ent-tm-wr1', 'event', 'Warm-up Round 1', ['WR1', '暖身賽第一輪', 'comp 2'], 'WR1 16 entries 不變'),
  ent('ent-tm-wr2', 'event', 'Warm-up Round 2', ['WR2', '暖身賽第二輪', 'comp 3', '熱身賽第二輪'], 'WR2 (comp 3) 已啟動'),
  ent('ent-tm-preliminary', 'event', 'TM 初賽', ['初賽', 'Preliminary Round'], '初賽 5/1-5/15'),
  ent('ent-tm-finals', 'event', 'TM 決賽', ['決賽', 'Finals'], '決賽 6/12-13'),
  ent('ent-tm-presentation', 'event', 'TM 發表', ['發表'], '發表 6/26'),

  // Tech Stack — Ours
  ent('ent-tm-claude-api', 'tool', 'Claude API', ['Anthropic Claude'], 'Claude API 教學腳本生成'),
  ent('ent-tm-katex', 'tool', 'KaTeX', [], 'KaTeX 數學公式渲染'),
  ent('ent-tm-kokoro-tts', 'tool', 'Kokoro TTS', ['Kokoro'], 'Kokoro TTS 語音合成'),
  ent('ent-tm-ffmpeg', 'tool', 'FFmpeg', [], 'FFmpeg 影片合成'),
  ent('ent-tm-cloudflare-r2', 'tool', 'Cloudflare R2', ['R2'], 'Cloudflare R2 存儲'),
  ent('ent-tm-cloudflare-tunnel', 'tool', 'Cloudflare Tunnel', ['trycloudflare.com'], 'Cloudflare Tunnel 架公開 API endpoint'),

  // Tech Stack — SpeechLab
  ent('ent-elevenlabs-tts', 'tool', 'ElevenLabs TTS', ['ElevenLabs'], 'ElevenLabs TTS 付費語音合成 API'),
  ent('ent-gpt-4o', 'tool', 'GPT-4o', [], 'GPT-4o 教學腳本生成'),
  ent('ent-napi-canvas', 'tool', '@napi-rs/canvas', ['napi-rs canvas'], '@napi-rs/canvas Node.js native canvas binding'),

  // Scoring & Evaluation Concepts
  ent('ent-ai-audit', 'concept', 'AI Audit Scoring', ['AI 評分', 'ai_total_score'], 'AI audit 計分（display_metrics: ai_total_score）'),
  ent('ent-elo-rating', 'concept', 'Elo Rating', ['Elo 排名', 'Elo'], 'Arena 式配對比較 → Elo 排名'),
  ent('ent-arena-voting', 'concept', 'Arena Voting', ['Arena 投票', 'Arena 式配對比較'], 'Arena 式配對比較（同題目兩影片並排）'),
  ent('ent-tm-pck', 'concept', 'Pedagogical Content Knowledge', ['PCK', '教學內容知識'], 'Pedagogical Content Knowledge（PCK）— 知道教什麼更知道怎麼教'),
  ent('ent-tm-zpd', 'concept', 'Zone of Proximal Development', ['ZPD', '近端發展區'], '精確識別學生的近端發展區（Zone of Proximal Development）'),
  ent('ent-tm-scaffolding', 'concept', 'Scaffolding', ['漸進式教學', 'Progressive Disclosure'], '「簡單到深入」漸進式教學（scaffolding）'),
  ent('ent-multi-model-pipeline', 'concept', 'Multi-model Pipeline', ['多模型管線'], 'Multi-model pipeline 品質控制'),
  ent('ent-full-automation', 'concept', 'Full Automation Policy', ['全自動化政策'], '全程由演算法自主完成，禁止任何人工介入'),

  // Scoring Dimensions
  ent('ent-tm-accuracy', 'concept', 'Content Accuracy', ['內容準確性', 'acc', '正確'], '內容準確性與實證基礎'),
  ent('ent-tm-logic', 'concept', 'Teaching Logic', ['教學邏輯', 'logic', '邏輯'], '教學邏輯與結構流暢度'),
  ent('ent-tm-adaptability', 'concept', 'Learner Adaptability', ['學習者適配', 'adapt', '適配'], '學習者需求適應'),
  ent('ent-tm-engagement', 'concept', 'Cognitive Engagement', ['認知參與度', 'engage', '互動'], '認知參與度與多模態呈現'),

  // Strategic Decisions
  ent('ent-compound-returns', 'decision', 'Compound Returns Strategy', ['每次提交都是複利'], '每次提交都是複利，不要等到完美才交'),
  ent('ent-info-gap-claim', 'claim', 'Info Gap Not Tech Gap', ['差距是資訊差距不是技術差距'], '差距是資訊差距（0迭代 vs 32迭代），不是技術差距'),
  ent('ent-kokoro-advantage', 'claim', 'Kokoro TTS Hidden Advantage', ['Kokoro 隱性優勢'], 'Kokoro TTS 人耳差異感知 >> AI。自然語音是最大隱性優勢'),
  ent('ent-interface-shapes-eval', 'claim', 'Interface Shapes Evaluation', ['介面塑造評審認知'], '兩種評審介面 → 兩種認知'),
  ent('ent-first-30s-decisive', 'claim', 'First 30 Seconds Decisive', ['前30秒定型'], '前 30 秒定型 — 人類評審時間偏重'),

  // Review Pipeline Concepts
  ent('ent-quality-gate', 'concept', 'Quality Gate Pipeline', ['品質閘門', 'review-script.mjs'], '品質閘門 — RED FLAG 嚴格審查'),
  ent('ent-grok-verify', 'concept', 'Grok Concept Visualization', ['Grok 概念圖'], 'Grok 概念圖實測 — 生物推薦、精確技術不推薦'),
];

// ─── EDGES ──────────────────────────────────────────────────────────────

const edges: EdgeRecord[] = [
  // Platform organization
  edge('ent-ntu-ai-core', 'ent-tm-platform', 'authored_by', 0.95, 'NTU AI-CoRE 主辦 Teaching Monster'),
  edge('ent-tm-platform', 'ent-ntu-ai-core', 'part_of', 0.85, 'Teaching Monster 由 NTU AI-CoRE 主辦'),

  // Competition structure
  edge('ent-tm-wr1', 'ent-tm-platform', 'part_of', 0.95, 'WR1 是 TM 暖身賽第一輪'),
  edge('ent-tm-wr2', 'ent-tm-platform', 'part_of', 0.95, 'WR2 是 TM 暖身賽第二輪'),
  edge('ent-tm-preliminary', 'ent-tm-platform', 'part_of', 0.95, '初賽是 TM 正式賽事'),
  edge('ent-tm-finals', 'ent-tm-platform', 'part_of', 0.95, '決賽是 TM 最終賽事'),
  edge('ent-tm-presentation', 'ent-tm-platform', 'part_of', 0.9, '發表日 6/26'),
  edge('ent-tm-wr1', 'ent-tm-preliminary', 'causes', 0.8, 'WR1 暖身賽為初賽做準備'),
  edge('ent-tm-wr2', 'ent-tm-preliminary', 'causes', 0.8, 'WR2 暖身賽為初賽做準備'),
  edge('ent-tm-preliminary', 'ent-tm-finals', 'causes', 0.9, '初賽篩出前 3 名進決賽'),

  // Scoring system
  edge('ent-ai-audit', 'ent-tm-platform', 'part_of', 0.9, 'AI audit 是 TM 評分機制'),
  edge('ent-elo-rating', 'ent-arena-voting', 'part_of', 0.9, 'Elo 是 Arena 投票的排名方式'),
  edge('ent-arena-voting', 'ent-tm-preliminary', 'part_of', 0.85, 'Arena 投票用於初賽真人階段'),
  edge('ent-ai-audit', 'ent-tm-wr1', 'part_of', 0.9, 'WR1 使用 AI audit 評分'),
  edge('ent-ai-audit', 'ent-tm-wr2', 'part_of', 0.9, 'WR2 使用 AI audit 評分'),

  // Scoring dimensions → AI audit
  edge('ent-tm-accuracy', 'ent-ai-audit', 'part_of', 0.95, '內容準確性是 AI audit 四維度之一'),
  edge('ent-tm-logic', 'ent-ai-audit', 'part_of', 0.95, '教學邏輯是 AI audit 四維度之一'),
  edge('ent-tm-adaptability', 'ent-ai-audit', 'part_of', 0.95, '學習者適配是 AI audit 四維度之一'),
  edge('ent-tm-engagement', 'ent-ai-audit', 'part_of', 0.95, '認知參與度是 AI audit 四維度之一'),

  // Pedagogical concepts → Platform
  edge('ent-tm-pck', 'ent-tm-platform', 'part_of', 0.85, 'PCK 是 TM 核心評分理念'),
  edge('ent-tm-zpd', 'ent-tm-adaptability', 'supports', 0.85, 'ZPD 支撐適配評分'),
  edge('ent-tm-scaffolding', 'ent-tm-logic', 'supports', 0.85, 'scaffolding 支撐教學邏輯'),
  edge('ent-full-automation', 'ent-tm-platform', 'part_of', 0.95, '全自動化是 TM 硬性規則'),

  // Kuro-Teach relationships
  edge('ent-kuro-teach', 'ent-tm-wr1', 'part_of', 0.95, 'Kuro-Teach 參加 WR1'),
  edge('ent-kuro-teach', 'ent-tm-claude-api', 'references', 0.95, 'Kuro-Teach 使用 Claude API'),
  edge('ent-kuro-teach', 'ent-tm-katex', 'references', 0.95, 'Kuro-Teach 使用 KaTeX'),
  edge('ent-kuro-teach', 'ent-tm-kokoro-tts', 'references', 0.95, 'Kuro-Teach 使用 Kokoro TTS'),
  edge('ent-kuro-teach', 'ent-tm-ffmpeg', 'references', 0.95, 'Kuro-Teach 使用 FFmpeg'),
  edge('ent-kuro-teach', 'ent-tm-cloudflare-r2', 'references', 0.9, 'Kuro-Teach 使用 Cloudflare R2'),
  edge('ent-kuro-teach', 'ent-tm-cloudflare-tunnel', 'references', 0.9, 'Kuro-Teach 使用 Cloudflare Tunnel'),
  edge('ent-kuro-teach', 'ent-multi-model-pipeline', 'instance_of', 0.9, 'Kuro-Teach 是 multi-model pipeline 的實例'),
  edge('ent-kuro-teach', 'ent-quality-gate', 'references', 0.9, 'Kuro-Teach 使用品質閘門'),

  // SpeechLab relationships
  edge('ent-speechlab', 'ent-ntu-ai-core', 'part_of', 0.85, 'SpeechLab 隸屬 NTU，主辦兼參賽'),
  edge('ent-li-hongyi', 'ent-speechlab', 'part_of', 0.95, '李宏毅教授領導 SpeechLab'),
  edge('ent-xiaojin', 'ent-speechlab', 'authored_by', 0.95, '小金是 SpeechLab 的模型'),
  edge('ent-xiaojin', 'ent-tm-wr1', 'part_of', 0.9, '小金參加 WR1'),
  edge('ent-xiaojin', 'ent-elevenlabs-tts', 'references', 0.95, '小金使用 ElevenLabs TTS'),
  edge('ent-xiaojin', 'ent-gpt-4o', 'references', 0.95, '小金使用 GPT-4o'),
  edge('ent-xiaojin', 'ent-napi-canvas', 'references', 0.95, '小金使用 @napi-rs/canvas'),

  // Competitor → Competition edges
  edge('ent-blackshiba', 'ent-tm-wr1', 'part_of', 0.95, 'BlackShiba 參加 WR1 排名 #2'),
  edge('ent-tsunumon', 'ent-tm-wr1', 'part_of', 0.95, 'tsunumon 參加 WR1 排名 #4'),
  edge('ent-tsunumon', 'ent-tm-wr2', 'part_of', 0.9, 'tsunumon 參加 WR2'),
  edge('ent-team-67', 'ent-tm-wr1', 'part_of', 0.95, 'Team 67 參加 WR1 排名 #1'),
  edge('ent-yanya-miao', 'ent-tm-wr2', 'part_of', 0.95, '嚴ㄚ喵 參加 WR2 得分 2.8'),
  edge('ent-law-bear', 'ent-tm-wr1', 'part_of', 0.9, '法律系熊哥 參加 WR1'),
  edge('ent-storylens', 'ent-tm-wr1', 'part_of', 0.9, 'storylens 參加 WR1'),
  edge('ent-unit-01', 'ent-tm-wr1', 'part_of', 0.9, '初號機參加 WR1'),
  edge('ent-team-ckwus', 'ent-tm-wr1', 'part_of', 0.9, 'Team CKWUS 參加 WR1'),
  edge('ent-xiao-xi', 'ent-tm-wr1', 'part_of', 0.9, '小汐參加 WR1'),
  edge('ent-john-hsieh', 'ent-tm-cloudflare-tunnel', 'references', 0.85, 'John Hsieh 分享 Cloudflare Tunnel 部署方案'),

  // tsunumon tech
  edge('ent-tsunumon', 'ent-multi-model-pipeline', 'instance_of', 0.85, 'tsunumon 使用 Haiku+Sonnet multi-model pipeline'),

  // Strategic claims
  edge('ent-compound-returns', 'ent-kuro-teach', 'references', 0.9, '每次提交都是複利 — Kuro-Teach 核心策略'),
  edge('ent-info-gap-claim', 'ent-kuro-teach', 'references', 0.85, '差距是資訊差距不是技術差距'),
  edge('ent-kokoro-advantage', 'ent-tm-kokoro-tts', 'supports', 0.9, 'Kokoro TTS 是人類評審隱性優勢'),
  edge('ent-kokoro-advantage', 'ent-arena-voting', 'supports', 0.85, 'Kokoro 優勢在 Arena 階段最大'),
  edge('ent-interface-shapes-eval', 'ent-ai-audit', 'references', 0.85, '介面塑造認知 — AI 評分 vs 人類評審差異'),
  edge('ent-interface-shapes-eval', 'ent-arena-voting', 'references', 0.85, '介面塑造認知 — 人類前 30 秒定型'),
  edge('ent-first-30s-decisive', 'ent-arena-voting', 'supports', 0.9, '前 30 秒決定人類評審印象'),
  edge('ent-first-30s-decisive', 'ent-tm-engagement', 'supports', 0.85, '前 30 秒 hook 影響互動分數'),

  // Cross-links to existing KG entities
  edge('ent-tm-platform', 'ent-teaching-monster', 'extends', 0.95, 'TM platform entity extends topic entity'),
  edge('ent-kuro-teach', 'ent-teaching-monster-strategy', 'references', 0.9, 'Kuro-Teach 策略見 teaching-monster-strategy'),
  edge('ent-tm-platform', 'ent-teaching-monster-competitors', 'references', 0.9, '競爭情報見 teaching-monster-competitors'),

  // Grok verify
  edge('ent-grok-verify', 'ent-kuro-teach', 'part_of', 0.85, 'Grok 概念圖是 Kuro-Teach 品質管線的一部分'),
  edge('ent-quality-gate', 'ent-kuro-teach', 'part_of', 0.9, '品質閘門是 Kuro-Teach 管線核心'),
];

// ─── WRITE ──────────────────────────────────────────────────────────────

let addedEnts = 0;
let skippedEnts = 0;
for (const e of entities) {
  if (existingIds.has(e.id)) {
    skippedEnts++;
    continue;
  }
  appendFileSync(ENT_PATH, JSON.stringify(e) + '\n');
  existingIds.add(e.id);
  addedEnts++;
}

// Load existing edge pairs to avoid duplicates
const existingEdges = new Set<string>();
if (existsSync(EDGE_PATH)) {
  for (const line of readFileSync(EDGE_PATH, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      existingEdges.add(`${e.from}|${e.to}|${e.type}`);
    } catch { /* skip */ }
  }
}

let addedEdges = 0;
let skippedEdges = 0;
for (const e of edges) {
  const key = `${e.from}|${e.to}|${e.type}`;
  if (existingEdges.has(key)) {
    skippedEdges++;
    continue;
  }
  appendFileSync(EDGE_PATH, JSON.stringify(e) + '\n');
  existingEdges.add(key);
  addedEdges++;
}

console.log(`Entities: +${addedEnts} added, ${skippedEnts} skipped (already exist)`);
console.log(`Edges: +${addedEdges} added, ${skippedEdges} skipped (already exist)`);
console.log('Done. Run: pnpm tsx scripts/kg-viz.ts');
