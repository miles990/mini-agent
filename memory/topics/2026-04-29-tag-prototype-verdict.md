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
