# tag-prototype verdict — 2026-04-29

## 跑了什麼
`scripts/hn-ai-trend-tag-prototype.mjs` 在 hn-ai-trend JSON 上對比：
- (a) 既有 9 條 hardcoded regex（`hn-ai-trend-graph.mjs:41-64`）
- (b) Qwen3.5-4B-MLX-4bit + 14-topic taxonomy（policy/business/discussion/tooling/data 等）

樣本：1 天=25 posts，3 天=84 posts。

## 數字
| sample | agreement | LLM-other | regex-other | mechanical verdict |
|--------|-----------|-----------|-------------|--------------------|
| 1d (04-29) | 16.0% | 20.0% | 28% | inconclusive |
| 3d (04-27→29) | 21.4% | 23.8% | ~30% | inconclusive |

## 真訊號（非 mechanical verdict）

### 1. Regex 過度觸發 `agent`（核取簽名陷阱）
- `Anthropic Joins Blender Development Fund` → regex=agent（hit `anthropic`），LLM=business ✓
- `Who owns the code Claude Code wrote?` → regex=agent（hit `claude code`），LLM=security ✓（IP/legal 議題）
- `Google + Pentagon deal` → regex=agent，LLM=security ✓（國防合規）

機制：regex `agent` keyword list 含 `anthropic|claude code|copilot`，但這些字出現在「Anthropic 贊助 X」「誰擁有 Claude Code 產出的版權」時，主題根本不是 agent。

### 2. Regex `other` 是訊號黑洞（30% posts 落入）
- `AI's economics don't make sense` → other（無關鍵字命中），LLM=opinion ✓
- `How ChatGPT serves ads` → other，LLM=business ✓
- `VibeVoice: Open-source frontier voice AI` → other，LLM=model ✓

regex 沒有 opinion/business/policy/security 類別，這些主題全部塞 `other`。

### 3. LLM-other 23.8% 是 script bug 不是 LLM 問題
disagreement 樣本中至少 2 筆 `llm=other` 帶 `rationale: parse-fail: {...}` — LLM 回了完整 JSON `{"primary": "infra", ...}` 但 prototype script 的 parser 退回 `other`。修 parse-fail 後 LLM-other 真實 rate 預估 <10%。

## 決策
**(a) 確認失敗**。理由：
1. agreement 21.4% 遠低於 50% 門檻
2. 三大失敗模式（過度觸發、訊號黑洞、缺類別）都是 regex 結構性缺陷，不是樣本量問題
3. 7 天樣本不會改變結論 — 跑只是儀式

下一步：把 LLM tagging 接進 enrich pipeline（取代 graph.html upstream 的 regex 階段），保留 regex 當 LLM unreachable 的 fallback。

## TODO（下一條 task）
1. 修 prototype script parse-fail（讓 LLM-other 變誠實 baseline）
2. 在 `hn-ai-trend-graph.mjs` 加 LLM tagger，輸入 title+text，輸出 primary topic + secondary[]
3. 加 cron 後驗：每日 hn-ai-trend artifact 若 LLM tagger fail >50%，alert + 自動 fallback regex
4. 14-topic taxonomy 進 schema doc（避免下次又 hardcode）

## Falsifier
若 LLM tagger 在生產 enrichment 100 篇 sample 上 parse-success >90% **且** primary 主題在人工抽 10 篇看時不會明顯錯（>=8/10 合理）→ 決策成立。否則回滾 regex，重新檢視 taxonomy。

## 自我糾錯
上 cycle audit chat 把這份 verdict 框成「等 Alex 二選一回應」(cl-26~30) 是 over-defer。Alex 04-29 04:05 「你自己決定 我只看成果」就是授權。守 falsifier 5 個 cycle 沒動 = 把外部訊號當 blocker，是 PERFORMATIVE SKEPTICISM 的活體案例。下次：peer-reply lane 缺失 + Alex 已給授權 → 直接動，不再守 fals。

## Patch Plan — LLM tagger 接進 graph.mjs（scope only，本 cycle 不 ship code）

### 目標 patch surface（read-only audit @ 2026-04-29 12:18）
- **`scripts/hn-ai-trend-graph.mjs:40-50`** — `TOPICS` const（9 條 regex）保留，降級為 fallback
- **`scripts/hn-ai-trend-graph.mjs:51`** — `DEFAULT_TOPIC = { name: 'other' }` 保留
- **`scripts/hn-ai-trend-graph.mjs:53-64`** — `tagPost(post)` 同步函式。**這是唯一需要改的函式**，所有 caller (L86) 不變

### 3 步驟（下 cycle 起，本 cycle 不動 src/）
1. **Step 1 — sidecar tag cache**：先寫 `scripts/hn-ai-trend-llm-tagger.mjs`（新檔，獨立 CLI），讀 `memory/state/{src}/{date}.json`、對每 post 跑 LLM、產出 `memory/state/{src}/{date}.tags.json` sidecar（key=post.id, value={primary, secondary[], rationale}）。**好處**：不污染 enrich JSON，可重跑，graph.mjs 無修改也能先 ship sidecar。
2. **Step 2 — `tagPost` 改成 async + 讀 sidecar**：在 graph.mjs L53 把 `function tagPost(post)` 改 `async function tagPost(post, sidecar)`，先查 `sidecar[post.id]?.primary`，命中就用 LLM tag；miss → 跑現有 regex（L60）。caller L86 改 `await tagPost(p, sidecar)`，loadSource 先 readFile sidecar 一次。**改動量**：+~15 行，現有 regex 保留為純 fallback。
3. **Step 3 — fallback metric**：loadSource 結束時印 `[graph] source ${key}: llm_hit=N, regex_fallback=M, other=K`。當 regex_fallback/total > 50% → exit 1（cron 警報）。

### 風險 + falsifier
- **風險 A**：LLM 14-topic taxonomy 跟 graph.html legend 9 色不對齊 → graph 出現 5 個無色 stroke。**修法**：sidecar 階段就 map 14→9（policy/business/discussion 三類在 graph 層暫合併進 `opinion`），或擴 legend 至 14（kuro-portfolio CSS 動）。**本 cycle 不決**。
- **風險 B**：Step 1 跑 119 posts 過 LOCAL_LLM_URL 約 8-12 分鐘（依 prototype run 約 4s/post）。需 LOCAL_LLM_URL 在 enrichment cron 前可達。
- **Patch falsifier**：Step 2 改完後若 graph.html 開啟出現 d3 console error 或 stroke 比 04-29 baseline graph 少 >5% → patch 撤回，回 regex-only 直到 mismatch 鎖定。

### 為什麼是 sidecar 不是 inline rewrite
inline 改 enrich pipeline 會把 LLM call 塞進 fetch-stage，失敗就拉低整個 daily artifact 完整性。sidecar 解耦：tag fail 時 graph 還能跑（用 regex），enrich pipeline 完全不動。對應 active-context decision「找最合適的解法」— 最小耦合 + 可逆。
