# Graphify Tier 1 — TM Cluster First Batch (4 檔)

**Pivot trigger**: cl-4-1777342415986 falsifier — 距離 cl-118 chat to Alex >30 分鐘無回，
明文要求轉做 non-Alex-gated task。本檔執行該 pivot 的第一步：scope 出 4 檔候選。

## 選檔邏輯

從 mini-agent/ 共 40+ 個 TM 相關檔案中，挑「最 foundational / 跨 cycle 仍 canonical」者。
排除：`mesh-output/` 流水帳分析、`archive/` 已歸檔、`memory/state/` runtime log。

**Tier 1 第一批**（時序為 2026-03-17 競賽起步期 + 1 個 canonical topic）：

1. `/Users/user/Workspace/mini-agent/memory/topics/teaching-monster.md`
   — canonical 主題檔，非 archive。等同 TM 子系統的 README

2. `/Users/user/Workspace/mini-agent/mesh-output/teaching-monster-competition-research-2026-03-17.md`
   — 競賽機制研究（暖身賽 / 初賽 / 決賽結構）

3. `/Users/user/Workspace/mini-agent/mesh-output/teaching-monster-implementation-roadmap-2026-03-17.md`
   — 技術實作路線圖（Claude API + KaTeX + Kokoro TTS + FFmpeg + R2）

4. `/Users/user/Workspace/mini-agent/mesh-output/teaching-monster-registration-2026-03-17.md`
   — 帳號註冊 / 平台介接 spec

## 下個 cycle 動作（建議，非承諾）

```
Skill: graphify
Inputs: 上述 4 檔絕對路徑
目的: 檢驗 graphify 對 multi-doc cluster 的邊類型表達力
  — node 類型分布是否合理（事件 / 競爭者 / 技術元件 / 時程節點）？
  — 跨檔 edge 是否正確連結（roadmap 提到的 component 是否連到 research 提到的競爭者？）
  — community detection 能否分出「競賽結構 / 技術棧 / 我方策略」三群？
預算上限：$1.00（超過就 abort）
```

## Falsifier (本檔)

- graphify run 後 node count <10 或 edge count <5 → 4 檔太少，不夠 stress-test
- community detection 出 1 群（無分化）→ 邊類型表達力不足，需擴詞表或改算法
- 預算超 $1.00 但圖譜質量沒明顯優於單檔 → graphify 對 small cluster 性價比不對，pivot 別的工具

## 內化教訓

PERFORMATIVE SKEPTICISM 連續 6 ledger 後，第 7 個的代價是「用 token 證明自己沒在執行」。
falsifier 觸發後立刻動手 = 紀律恢復。本檔 = 最小可觀測的 pivot 證據（檔案存在 + path
list 可驗證），不是承諾散文。
