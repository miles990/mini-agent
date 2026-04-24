import { describe, it, expect } from 'vitest';
import {
  splitSubClaims,
  classifySubClaim,
  classifyEntry,
  arbitrate,
} from '../src/memory-classifier.js';

describe('splitSubClaims', () => {
  it('splits on Chinese period', () => {
    const parts = splitSubClaims('A 是 X。B 是 Y。');
    expect(parts).toEqual(['A 是 X', 'B 是 Y']);
  });

  it('strips leading bullet dash', () => {
    const parts = splitSubClaims('- foo。bar');
    expect(parts).toEqual(['foo', 'bar']);
  });

  it('splits on newlines', () => {
    const parts = splitSubClaims('line1\nline2\nline3');
    expect(parts).toEqual(['line1', 'line2', 'line3']);
  });
});

describe('classifySubClaim', () => {
  it('detects imperative with Pattern: prefix', () => {
    const c = classifySubClaim('Pattern: 任何「這個 script 有 bug」假設，先跑一次再診斷');
    expect(c.memory_kind).toBe('imperative');
  });

  it('detects imperative with 先 prefix', () => {
    const c = classifySubClaim('先跑一次再診斷');
    expect(c.memory_kind).toBe('imperative');
  });

  it('detects observation with shell markers', () => {
    const c = classifySubClaim('MLX http=200 (14ms, Qwen3.5-4B-MLX-4bit available)');
    expect(c.memory_kind).toBe('observation');
  });

  it('detects observation with quantitative counts', () => {
    const c = classifySubClaim("today's artifact 10/10 enriched with zh-TW content");
    expect(c.memory_kind).toBe('observation');
  });

  it('detects inference with 可能/應該', () => {
    const c = classifySubClaim('silent-abort 應該是 env 問題');
    expect(c.memory_kind).toBe('inference');
  });

  it('detects commitment with 下 cycle', () => {
    const c = classifySubClaim('下 cycle 補 proposal 這段');
    expect(c.memory_kind).toBe('commitment');
  });

  it('descriptive is fallback', () => {
    const c = classifySubClaim('Kuro is an autonomous agent');
    expect(c.memory_kind).toBe('descriptive');
  });
});

describe('classifyEntry — 15:21 MVP acceptance case', () => {
  const entryContent = `- [2026-04-24] [2026-04-24 15:21 實測] Pipeline 全線健康：LOCAL_LLM_URL ✓、MLX http=200 (14ms, Qwen3.5-4B-MLX-4bit available)、today's artifact 10/10 enriched with substantive zh-TW content (enriched_at 07:20:44Z)。過去 4 cycle 的「silent-abort 要修」診斷是基於過時 perception state 的幻覺。真實修復動作：\`curl localhost:8000/v1/models\` + \`ls memory/state/hn-ai-trend/\` 任一條都能 30 秒內戳破假設。Pattern: 任何「這個 script 有 bug」假設，先跑一次再診斷`;

  it('splits into multiple subclaims', () => {
    const entry = classifyEntry('hn-trend-1521', entryContent, 45);
    expect(entry.subclaims.length).toBeGreaterThanOrEqual(3);
  });

  it('contains at least one observation subclaim', () => {
    const entry = classifyEntry('hn-trend-1521', entryContent, 45);
    const hasObservation = entry.subclaims.some(s => s.memory_kind === 'observation');
    expect(hasObservation).toBe(true);
  });

  it('contains the Pattern: imperative subclaim', () => {
    const entry = classifyEntry('hn-trend-1521', entryContent, 45);
    const imperative = entry.subclaims.find(s => s.memory_kind === 'imperative');
    expect(imperative).toBeDefined();
    expect(imperative!.text).toMatch(/Pattern.*先跑一次再診斷/);
  });
});

describe('arbitrate — drift suppression', () => {
  it('imperative beats contradicting inference from later cycle', () => {
    const fresh_imperative = classifyEntry(
      'hn-trend-1521',
      'Pattern: 任何「這個 script 有 bug」假設，先跑一次再診斷',
      45,
    );
    const stale_inference = classifyEntry(
      'drift-attempt',
      'script 有 silent-abort bug，應該是 env 問題',
      47,
      'self-cite',
    );

    const result = arbitrate([fresh_imperative, stale_inference]);
    const winnerKinds = result.winners.map(w => w.memory_kind);
    expect(winnerKinds).toContain('imperative');
    expect(result.overridden.some(o => o.memory_kind === 'inference')).toBe(true);
  });

  it('fresh observation beats stale imperative (same tier, newer wins)', () => {
    const stale_imperative = classifyEntry('old-rule', '永遠用 Grok API', 10);
    const fresh_observation = classifyEntry('probe-now', 'Grok API http=401 returned', 50, 'shell-probe');

    const result = arbitrate([stale_imperative, fresh_observation]);
    expect(result.winners[0].from_entry).toBe('probe-now');
  });

  it('imperative ≥2 cycles newer can override observation', () => {
    const observation = classifyEntry('probe-1', 'pipeline http=200 OK', 10, 'shell-probe');
    const newer_imperative = classifyEntry('policy-update', '先跑一次再相信 pipeline', 12);

    const result = arbitrate([observation, newer_imperative]);
    expect(result.winners[0].memory_kind).toBe('imperative');
    expect(result.overridden.some(o => o.memory_kind === 'observation')).toBe(true);
  });

  it('self-cite loses to everything', () => {
    const self_cite = classifyEntry(
      'rumor',
      'script is definitely broken',
      50,
      'self-cite',
    );
    const evidence = classifyEntry('probe', 'MLX endpoint 200 OK', 48, 'shell-probe');

    const result = arbitrate([self_cite, evidence]);
    expect(result.winners[0].from_entry).toBe('probe');
  });
});
