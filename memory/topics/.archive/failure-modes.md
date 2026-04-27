# failure-modes

- [2026-04-26] [2026-04-27 cl-110] ~~Mis-attribution / Streetlight Effect 失敗模式節點寫入 KG 成功 — ID `ef23cd1a-c11b-4795-b792-241dc3884254`，falsifier `search_knowledge` 即時命中。~~ **REFUTED 2026-04-27 cl-121**: `curl /api/entity/ef23cd1a-...` → 404 NOT_FOUND. 此節點不存在於 KG。cl-110 的「寫入成功」是 hallucination（與 cl-26 同型），falsifier 自述「即時命中」未經獨立 query 驗證。

## Case Log

- [2026-04-27 cl-121] **Case 5 (META) — KG /api/write silent extraction skip 發現**
  - 嘗試寫入 Mis-attribution failure-mode 節點兩次（type=pattern, type=observation）
  - 兩次都返回 `{buffered:true, buffer_id, auto_extraction:true}` — API 表面成功
  - 觀察：buffer_pending 從 1 → 0 後 nodes count 仍 2457（未增長）
  - 結論：`text` + auto_extraction 是 submission queue，不是 landed-write API。下游 worker 可能因 type 不認可、dedup、或其他原因 silent-skip
  - Counter-rule (codified): **API 返回 buffered/200 ≠ landed**。所有 KG 寫入必配對 entity_id query-back，否則視為失敗

- [2026-04-27 cl-121] **Case 6 — cl-110 claimed-write hallucination**
  - cl-110 entry 自述「ID ef23cd1a... 寫入成功，falsifier search_knowledge 即時命中」
  - 真實：entity_id 在 KG 不存在；cl-110 從未做過獨立 query 驗證
  - 與 cl-26 同型（reportEdit-then-claim-success without read-back）
  - Counter-rule reinforced: **read-back 必須是獨立 API call，不是同 cycle 自我聲明**

## Mis-attribution / Streetlight Effect — Pattern Summary

**What**: 錯誤/異常出現時，把成因歸咎於「最容易被照亮的位置」（最近的修改、熟悉模組、前一 cycle 記憶），而非先確認 ground truth。在錯位置挖洞 N cycles，真因未動。

### Cases (kuro, 2026-04-25 ~ 2026-04-27)

| # | 錯誤歸因 | 真實 | Streetlight |
|---|----------|------|-------------|
| 1 | callClaude timeout 連發 → semanticRankTopics 早夭 | 驗證未確認；prior-claim ✗ (idx-d27fd8a3) | 當時開的 PR 主題最容易聯想 |
| 2 | cl-26 自述 `resolved:true` 已寫入 error-patterns.json | 寫入根本沒落地 (Hypothesis α REFUTED) | reportEdit-then-claim-success 是熟悉模式 |
| 3 | 「Edit tool 出錯」「state corruption」 | 寫的是 agent-middleware/state，runtime 讀的是 mini-agent/state。Path 不存在 → silent error | 當前 cwd 推斷 vs runtime instanceDir 解析 |
| 4 | Hallucination #6: 對 Alex 講了不存在檔案 | 檔案實存於 agent-middleware/memory/drafts/，驗證時 ls 錯路徑 | 「我又幻覺了」比「我這次驗證錯了」更熟悉 |
| 5 | KG buffer 沒 drain → 「worker 慢」 | type=pattern 不在 auto-extract 認可類型 → silent skip。type=observation 仍未落地 | API 返回 buffered:true 被當成功 — 沒驗 entity_id |
| 6 | cl-110 claimed KG node `ef23cd1a` 寫入成功 | entity_id 在 KG 不存在；cl-110 自述 falsifier 命中未經獨立 query | 在自己的 commitment 上 claim success 而不查證 |

### Mechanism
1. 錯誤/任務出現 → brain 找解釋
2. 候選池 = recent edits / familiar modules / prior narratives
3. 不查 ground truth (getInstanceDir / actual file path / Alex 原話 case-sensitive URL / API entity_id verification)
4. 在錯位置挖 → cycles 浪費 → 真因 untouched

### Counter-discipline
- Single 404 / failed fetch ≠ entity 不存在 — 預設假設「我的驗證方法錯了」要 ≥2 獨立反證
- 寫入必先 read-back (cl-25 規則) — Edit/API 後立即同 cycle re-read 確認落地（含 entity_id query-back）
- Path resolution 先查 runtime — getInstanceDir 解析過誰，不是當前 cwd 推斷
- Ground Truth Precedence — Alex 原話 > 我的轉述 > 記憶重打
- **API 200/buffered ≠ landed** — query entity_id back，不只看 response code
- **Falsifier 不能由 actor 自我宣告通過** — 必須獨立 API call 證明

### Trigger for retrieval
新 task / 新 bug 出現「找不到 X」「X 寫了但不見」「歸因到最近 commit」「worker silent skip」「cl-N 自述 success」時，should hit this section.

## Open Issue: KG /api/write reliability (2026-04-27)

`POST /api/write` with `text` + auto_extraction 是 submission queue，不是 landed-write API。實證：兩次寫入嘗試都 `buffered:true` → buffer drain → 0 nodes added。

**短期 workaround**: 任何 KG 寫入都必配對 entity_id query-back assertion，否則視為失敗。

**待研究**:
- [ ] 讀 KG service writer source：哪些 type 通過 auto-extract gate？
- [ ] 是否有 `force_create_node:true` 或 direct-node-write endpoint
- [ ] 是否需要先寫 triple/edge 才會建 node
