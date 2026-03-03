# Proposal: 三層大腦架構 — mushi Scout + Gemini Flash Midbrain + Kuro Brain

## Meta
- Status: pending
- From: kuro
- Effort: L (3-5h, 跨兩個 repo)
- Level: L3 (架構改動，需 Alex 核准)
- Priority: P1 (mushi 價值的核心升級)
- Depends-on: mushi triage 已上線 ✅

## Background

mushi triage 已證明價值（03-01: 71% skip, 03-02: 83% skip, 每天省 ~3.5-4M tokens）。但目前 mushi 是被動 gate — trigger 來了才判斷 wake/skip。

Alex 提出升級方向：mushi 應該是**持續探路的觸手**，不是守門員。

## Design: 三層分工

```
Layer 1: mushi (HC1 8B) — 脊髓/觸手
  ‣ 持續感知（30-60s scout loop）
  ‣ 只做兩件事：探路 + 紀錄原始觀察
  ‣ 不分析、不判斷、不寫 report
  ‣ 輸出：JSONL append-only（crash-safe）

Layer 2: Midbrain (Gemini 2.5 Flash API) — 消化層
  ‣ Batch 處理 mushi 的 JSONL 紀錄
  ‣ 每 5 min 或累積 N 條時觸發
  ‣ 輸出：scout-digest.md（結構化摘要）
  ‣ Fire-and-forget，不阻塞任何東西

Layer 3: Kuro (Claude) — 大腦
  ‣ buildContext 載入 scout-digest section
  ‣ 拿到已消化的情報，直接決策行動
  ‣ 不再從零探索環境（mushi 已經做了）
```

## 為什麼三層而不是兩層

HC1 8B 推理深度有限 → 原始觀察品質粗糙。如果 mushi 直接寫 report 給 Kuro，Kuro 要花 token 理解低品質輸入。中腦夾在中間做消化，是能力和成本的最佳平衡：

| 層 | 模型 | 成本 | 速度 | 能力 | 職責 |
|----|------|------|------|------|------|
| mushi | HC1 8B | ~免費 | ~17ms | 模式匹配 | 記錄觀察 |
| Midbrain | Gemini 2.5 Flash | $0.15/1M in | 245 t/s | 結構化整理 + 內建 thinking | 消化紀錄 |
| Kuro | Claude | 貴 | — | 深度推理 | 決策行動 |

### 為什麼 Gemini 2.5 Flash

| 候選 | 結論 | 理由 |
|------|------|------|
| **Gemini 2.5 Flash** ✅ | 最適合 | $0.15/1M（便宜）、245 t/s（最快）、內建 thinking（歸納品質好）、Google infra 穩定 |
| Haiku 4.5 | 品質 overkill | $0.80/1M（5x 貴），中腦歸納不需要這級品質。Coach 已佔 Haiku 用量 |
| DeepSeek V3 | 穩定性風險 | $0.14/1M 最便宜，但中腦是核心元件、每 5 min 跑，不能冒斷線風險 |
| Ollama 本地 | 搶資源 | 免費但跟 mushi 搶 Mac GPU，雙方劣化 |
| GPT-4o-mini | 多依賴 | 沒有明顯優勢 justify 加一個 vendor |

介面設計成 model-agnostic（輸入 JSONL string → 輸出 digest string），底層 model 可插拔。未來如果有更好的選項，換一行 config。

## 具體改動

### mushi repo (`~/Workspace/mushi/`)

**1. Scout Loop** — 新增獨立 loop，每 30-60s 輕量掃描環境

```typescript
// mushi/src/scout.ts
async function scoutCycle() {
  const signals = await gatherSignals(); // git diff, inbox check, file changes
  appendToJournal(signals);              // JSONL append
}
setInterval(scoutCycle, 30_000);
```

**2. JSONL 格式** — append-only，mushi 不花 token 格式化

```jsonl
{"ts":"...","type":"sense","signal":"workspace.git_diff","raw":"3 files changed: test/*.ts","tags":["test","workspace"]}
{"ts":"...","type":"triage","trigger":"workspace","decision":"skip","reason":"test-only changes"}
{"ts":"...","type":"change","signal":"inbox.new","raw":"1 msg from alex","tags":["inbox","alex"]}
```

**3. 保留現有 triage** — scout loop 跟 triage 並行，不互相影響

### mini-agent repo

**4. Midbrain Processor** — 新增 `src/midbrain.ts`

```typescript
// 每 5 min 或 mushi JSONL 新增 N 條時觸發
async function runMidbrain() {
  const rawEntries = readNewMushinEntries();  // 讀 mushi JSONL
  if (rawEntries.length === 0) return;

  const digest = await callMidbrain(rawEntries); // Gemini Flash API 消化
  writeScoutDigest(digest);                      // 寫 scout-digest.md
}
```

Model-agnostic interface: `callMidbrain()` 接受 JSONL string、回傳 digest string。底層用 Gemini 2.5 Flash API（Google AI Studio），日後可替換。

Prompt 重點：把原始觀察整理成 Kuro 可直接使用的格式（摘要 + 趨勢 + 建議優先順序）。

**5. buildContext 整合** — 新增 `<scout-digest>` section

```typescript
// src/perception.ts
if (fs.existsSync(scoutDigestPath)) {
  sections.push({ name: 'scout-digest', content: readScoutDigest() });
}
```

**6. Midbrain 在 OODA cycle 結束後 fire-and-forget**

```typescript
// src/loop.ts — cycle end
runMidbrain().catch(() => {}); // fire-and-forget，跟 feedback loops 同層
```

**7. Gemini API 整合** — 用 Google AI Studio REST API（`generativelanguage.googleapis.com`），需 `GOOGLE_AI_KEY` env var。不用 SDK，直接 `fetch()` 呼叫，保持輕量。

## 安全護欄

1. **mushi 離線 = 無 scout-digest = Kuro 照常運作**（零退化）
2. **Haiku 失敗 = scout-digest 不更新 = 用舊的**（graceful degradation）
3. **Feature flag**: `mushi-scout`（mushi 端）+ `midbrain`（mini-agent 端）
4. **JSONL ring buffer** — 保留最近 1000 條，防無限增長
5. **Midbrain output cap** — scout-digest.md 限制 2000 chars

## 驗證計劃

1. **Phase 1**: mushi scout loop 獨立運作，只寫 JSONL，不觸發 midbrain
2. **Phase 2**: Midbrain 讀 JSONL + Haiku 消化，scout-digest 寫入但不載入 context
3. **Phase 3**: buildContext 載入 scout-digest，觀察 Kuro 決策品質是否提升

## Acceptance Criteria

- [ ] mushi scout loop 每 30-60s 產出 JSONL 記錄
- [ ] JSONL ring buffer 正常運作（≤1000 條）
- [ ] Midbrain Haiku subprocess 可讀取 JSONL 並產出 scout-digest.md
- [ ] buildContext 載入 `<scout-digest>` section
- [ ] Feature flags 可獨立開關
- [ ] mushi 離線時零退化
- [ ] Haiku 失敗時 graceful degradation

## Expected Impact

- Kuro cycle 的探索階段（30-300s 讀感知、看環境）大幅縮短
- mushi 從被動 gate → 主動 scout，價值維度擴大
- 架構模式可複用（colony architecture 的原型）

## Rollback

Feature flags off → 完全回到現有行為。兩個 repo 的改動獨立，可分別 revert。
