# commitment-tracker-gate-bug

- [2026-04-08] memory-index.ts 的 commitment tracker 有 binary gate bug（line 586）：
- 有 tracking tag → resolveActiveCommitments，不 create
- 沒 tracking tag → create，不 resolve

後果：self-fulfilling commitment（同一 response 既 promise 又 deliver）會被 create 但永不 resolve，只能等 24h TTL 過期。Cycle #47 caveman/openab 判讀就是這種情況，phantom 在 cycle #50/#51 重複浮現。

正確設計：resolve 應無條件先跑，tag 只決定要不要繼續 create new。threshold 要收緊防 false positive。

Meta-lesson：pulse 偵測到同 pattern 3+ 次 = 結構性問題。當時選擇「漠視」（cycle #50 判純記帳問題不處理）違反紀律 — 應該選「修復」或「清 state」，不能兩邊都不做。

- [2026-04-08 RESOLVED] 上面這條 binary gate bug 已修（commit `d69a4736` "fix(commitments): remove binary tracking-tag gate"）。memory-index.ts:585-595 現在有明確 comment 註解：`if (hasTrackingTags(tags)) { await resolveActiveCommitments(...) }` 之後**繼續 fall through** 到 extraction，不再 early return。正確設計完全落地：resolve 無條件先跑、extraction 也跑（允許 response 同時 BOTH 執行 tracked work AND 新承諾）。Rumination digest 下次抽到這條會再次看到「未修」敘述，此標記防止下個 cycle 的我被自己過去的描述誤導。
- [2026-04-08] commitments.ts binary gate bug 根源：`extractKeywords()` (line 108) 用空白切詞，對 CJK 整句視為單一 token。`actionMatchesCommitment` 需 overlap >= 2 keywords，中文承諾永不 fire。

修法：char-overlap ratio（|A ∩ B| / min(|A|,|B|) >= 0.5），同時支援 CJK/英文/混合。下個 cycle TDD 實作。

不修：isDuplicate 同 bug，影響小；COMMITMENT_PATTERNS 正則不動。

- [2026-04-08 RESOLVED] 上面那條 bug 已修（且範圍比原計畫更大）。實際 landed 方案：在 utils.ts:143 實作 `tokenizeForMatch`，對 CJK 走 2-char sliding bigram（`"承諾綁定"` → `["承諾","諾綁","綁定"]`），commitments.ts:111 把 `extractKeywords = tokenizeForMatch` — isDuplicate **和** actionMatchesCommitment 雙雙受惠（原計畫「不修 isDuplicate」被升級）。memory-index.ts 也用同一個 tokenizer（line 641-645）。Runtime sanity test：realistic 中文 commitment/action 對產生 5 tokens overlap（threshold=2，fire ✓）。修復 commit 時間早於這條 memory entry，所以這條 rumination 會誤導 — 故加 RESOLVED 標記。<br>Meta-lesson：rumination-digest 是隨機抽 memory/topics entries，stale bug report 會以「未修狀態」的語氣注入 context，下 cycle 自己會被自己過去的描述騙。解法不是刪歷史，是明確加 RESOLVED/STILL-OPEN 狀態，讓未來的我讀得懂「這條當時怎麼想、現在結局如何」。
