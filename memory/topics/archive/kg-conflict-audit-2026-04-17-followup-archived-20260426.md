# KG conflict audit — follow-up（2026-04-17）

承接 `kg-conflict-audit-2026-04-17.md`。Reconciliation script 跑完，數字精準化，可動手修復清單列出。

## Reconciliation 真實數字

跑 `scripts/reconcile-conflicts-audit.py`，比對 `memory/index/conflicts.jsonl` ↔ `memory/index/resolution-audit.jsonl`：

| 指標 | 值 | audit 報告原寫 |
|---|---|---|
| Total rows 兩邊 | 23 / 23 | 23 / 23 ✓ |
| Fully agree | 14 (61%) | — |
| Winner mismatch | 5 (22%) | 6/23 |
| Rule mismatch | 7 (30%) | 7/23 ✓ |
| Missing in either | 0 | 3 |

報告原寫的「3 missing」當下狀況已經補齊（兩邊都 23/23），所以差別從 6+3 變成 5+0。

報告產出物：`memory/reports/conflict-audit-reconcile-2026-04-17.json`（machine-readable，含每筆 row）

## 4 類具體修復

### Class A — R6/R7/R8 在 conflicts.jsonl 缺欄位（3 筆，hotfix 可逆）

| ID | Entity | conflicts | audit |
|---|---|---|---|
| conf-type-4 | ent-coderlm | `winner=None, rule=None` | `winner=project, rule=R5` |
| conf-type-13 | ent-mushi | `winner=None, rule=None` | `winner=project, rule=R8` |
| conf-type-20 | ent-self-evolution-foundations | `winner=None, rule=None` | `winner=concept, rule=R8` |

**根因**：conflicts.jsonl 的 rubric 是 R1-R5+MISC，audit 的 rubric 是 R1-R8。R6-R8 在 conflicts 沒對應欄位定義 → resolver 寫入 audit 但漏寫 conflicts。

**Hotfix**：把 audit 的 winner/rule 補到 conflicts.jsonl 同筆 row。
**源頭修**：conflicts emitter 加 R6-R8 schema 支援。

### Class B — dual-role artifact/code-symbol 強降（2 筆，需重判）

| ID | Entity | conflicts | audit |
|---|---|---|---|
| conf-type-18 | ent-perception-stream-ts | `winner=artifact` | `winner=code-symbol` |
| conf-type-22 | ent-src-loop-ts | `winner=artifact` | `winner=code-symbol` |

**根因**：兩個 entity 同時是「具體 .ts 檔案」(artifact) 和「載入到 runtime 的 module symbol」(code-symbol)。R5 規則允許 dual-role list `[artifact, code-symbol]`，但兩邊各自把它降成單值，方向相反。

**修法**：兩邊 winner 都改成 `["artifact", "code-symbol"]`，rule 標 R5。

### Class C — R4↔R5 錯位（2 筆，兩個 rule 都合理，需選定）

| ID | Entity | conflicts.rule | audit.rule |
|---|---|---|---|
| conf-type-3 | ent-claude | R5 | R4 |
| conf-type-7 | ent-github-account-kuro-agent | R5 | R4 |

**根因**：R4（external system / vendor）跟 R5（legitimate dual-role）邊界模糊。需要明確判準：是「外部 actor」(R4) 還是「同一 entity 兼具兩角色」(R5)？

**建議**：
- ent-claude → R4（Anthropic 的 model，是外部系統）
- ent-github-account-kuro-agent → R4（GitHub 的 account，外部資源）

### Class D — 個案重判（2 筆）

| ID | Entity | conflicts | audit |
|---|---|---|---|
| conf-type-9 | ent-heartbeat | rule=R5 | rule=R2 |
| conf-type-21 | ent-semantic-caching | rule=MISC | rule=R6 |

- **ent-heartbeat**：HEARTBEAT 是 markdown 區段名 + cycle 機制名。R2（file with extension）顯然不對，HEARTBEAT 不是檔案。R5（dual-role）較合理：identifier + concept。
- **ent-semantic-caching**：MISC vs R6。R6 是「abstract pattern across systems」，semantic caching 確實是 pattern → R6 對。

## 下一步動作清單

1. **Hotfix Class A** — 寫 patch script，把 3 筆缺欄位從 audit copy 到 conflicts。可逆（有 backup）。
2. **Hotfix Class B** — 改 2 筆 winner 為 list `[artifact, code-symbol]`。
3. **判決 Class C+D** — 4 筆按本檔建議改，需 Alex 確認 R4 vs R5 判準。
4. **修源頭** — conflicts emitter schema 加 R6-R8 + dual-role winner 用 list 而非單值。
5. **rubric 對齊** — 寫 `memory/index/RUBRIC.md`，把 R1-R8 + MISC 定義集中到一處，conflicts emitter / resolver / audit 都引用同一份。

## 為什麼這份 follow-up 而不是直接動手

修 file 是 hotfix；修 emitter/resolver code 才是源頭。本 cycle 已產 reconciliation script + 報告（deliverable），下個 cycle 從 Class A hotfix 開始，逐步往源頭走。Class C/D 的判決方向需要 Alex 確認 R4 vs R5 的判準才不會再次產生 mismatch。
