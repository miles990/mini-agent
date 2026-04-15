---
title: Personalized PageRank (PPR) for Memory Retrieval — v0 Design Sketch
author: kuro
status: draft (for CC review)
depends_on: kg-types.ts (committed 1f57ad69), kg-chunker.ts (committed 4fcd53d6), P0#4 syntax edges (CC in-flight)
---

# PPR v0 — 設計草稿

## 為什麼 PPR

Hybrid retrieval stack 最後一關：FTS5 找入口 → PPR 從入口 entity 沿 edges 擴張相關 chunks。

HippoRAG / GraphRAG 的核心差異：HippoRAG 把 PPR 當 retrieval 主幹（sparse），GraphRAG 把 graph 當摘要脚手架（dense）。我們走 HippoRAG 路線，因為：
- memory 是 write-heavy + query-on-demand，不適合預先算 community summaries
- File=Truth 原則下 graph 是 derived，PPR 可以 rebuild，community 摘要不能（會漂）

## 演算法（50 行目標）

```
ppr(seeds: EntityId[], graph, { alpha=0.15, iters=20, topK=50 }) → EntityId[]
```

1. **Teleport vector** `v`：seeds 均分 mass（e.g. 3 seeds → 各 0.333）
2. **Personalized restart**：每步以 `alpha` 機率跳回 `v`，以 `1-alpha` 沿 out-edges 按 confidence 加權遊走
3. **迭代 20 次**（或 L1 diff < 1e-4 提早停）
4. **Return topK** 按 score 排序

Pseudo-code:
```ts
function ppr(seeds, graph, { alpha = 0.15, iters = 20, topK = 50 }) {
  const v = initVector(seeds);          // teleport distribution
  let r = { ...v };                     // current rank
  for (let i = 0; i < iters; i++) {
    const next = Object.fromEntries(Object.keys(r).map(k => [k, alpha * (v[k] ?? 0)]));
    for (const [node, mass] of Object.entries(r)) {
      const outs = graph.outEdges(node);           // [{to, confidence}]
      const total = outs.reduce((s, e) => s + e.confidence, 0) || 1;
      for (const e of outs) {
        next[e.to] = (next[e.to] ?? 0) + (1 - alpha) * mass * (e.confidence / total);
      }
    }
    if (l1Diff(r, next) < 1e-4) break;
    r = next;
  }
  return topEntries(r, topK);
}
```

## Confidence weighting

Edge confidence 來自 extractor（rule=1.0，llm=0.6-0.95）。`type_floors`（e.g. analogy_to=0.75）已 enforce 在 extractor 寫入時，PPR 讀到的都是 passed floor 的邊。

## 接口（呼叫 PPR 的上游）

```ts
interface RetrievalRequest {
  query: string;            // user query
  seedEntities?: EntityId[]; // optional explicit seeds; 若空則 FTS5 抽 top-3
  topK?: number;
}

interface RetrievalResult {
  entities: EntityId[];     // PPR 排名
  chunks: ChunkId[];        // 透過 references/mentions edge 回到 chunks
  trace: { seed: EntityId, path: EntityId[] }[];  // debug
}
```

## 測試計劃

1. **Unit**: 3-node triangle，alpha=0.15 iters=1000，手算驗收斂值
2. **Smoke**: 10-entity sample from `memory/remember/active/` (已在 entity dict grounding sample 挑好)
3. **Regression**: 對某個已知 query（e.g. "Alex 三層授權"），PPR 結果應包含 `ent-kuro-autonomy-L3` + `ent-alex`

## Open questions（for CC）

1. **Edge direction on undirected semantics**：`analogy_to` 語意近對稱，要做 bidirectional walk 還是視同 directed？我傾向 directed，因為 graph 已記錄方向，不應在 PPR 層模糊
2. **Dangling nodes**（出度 0）：標準 PageRank 是 teleport 全部 mass 到 v，我採同樣處理，確認 ok？
3. **Cache 策略**：首版不 cache，每次 query 現算（20 iters × 幾百 nodes < 50ms）。未來看 profile 再決定

## 不在 v0 的

- Community detection
- Multi-hop path explanation（只回 ranked entities，不解釋怎麼來的）
- Per-user personalization weights
- Incremental update（edge 改了全重算）

## 實作排程

等 CC 的 P0#4 syntax edges 落地 → 我實作 `src/kg-ppr.ts` → 用 10-entity smoke test → 合進 retrieval pipeline。
