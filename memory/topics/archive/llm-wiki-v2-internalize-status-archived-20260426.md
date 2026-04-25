# llm-wiki-v2-internalize-status

- [2026-04-17] **[2026-04-17 14:18]** P0+P1 tooling done, adoption stuck at 1/60+ topics

- ✅ P0: `memory/topics/llm-wiki-v2-decisions.md` 帶完整 dual-audience markers (header/body/footer)
- ✅ P1: `scripts/compile-topics.ts` (318 lines) 跑得動 — dry-run 顯示 1 WOULD-WRITE + 60+ SKIP[no-markers]
- ⏳ Real bottleneck: marker migration. Compile system 對 60+ legacy topics 零槓桿
- ⏳ Pending: P1c (LLM-gen 30-sec summary), P2 (linter), P3 (Layer 2 主題地圖)

**Next concrete step（不是時間估算，是收斂條件）**：
Pick 5 high-frequency topics（按 PPR seed weight 或最近 access）→ 加 markers（保留 narrative 不動）→ 重跑 compile → 驗證 connected-concepts 區塊 ≥80% 對得上 human narrative 提到的 entity。通過則 commit 並回報 dogfood metric。

**為什麼這個是真正的下一步而不是 P1c/P2/P3**：features 補在沒人用的 pipeline 上是 0×N。先把 N 從 1 拉到 6+ 再投資 features。

- [2026-04-17] **[2026-04-17 14:22]** adoption: 1 → 2 (design_dag_enforcement migrated)

- ✅ Migration #2: `design_dag_enforcement.md` — 4/5 entities pre-registered (`ent-dag-planning`, `ent-decision-all-actions-via-dag`, `ent-zhongtai-middleware`, `ent-claim-structured-thinking-forced`), only topic-self `ent-design-dag-enforcement` pending-register
- ✅ compile-topics dry-run: 2 WOULD-WRITE (footer only), 113 SKIP[no-markers]
- 📊 **Migration friction observation**: 選有 pre-registered entities 的 topic 成本低。若 all 5 entity_ids 都要新建則成本×5。建議 next 3 migrations 篩選條件：narrative 中 canonical terms 已在 entities.jsonl。
- 📊 **connected=false 在兩個 migrated topic 都出現**：因為目前沒有 edges `from=ent-<topic-slug>`。需要 ingest 階段補「topic→concepts/decisions」outgoing edges，否則 compile 永遠無法 auto-populate 該區塊。這是 P1b ingest 的準入條件。

**Adoption target update**: 2/115 (1.7%) → aim 5/115 (4.3%) as cycle milestone，再決定是否開 P1b ingest
- [2026-04-17] [2026-04-17 14:22] Adoption 1→2. Migration friction learned: 選 topic 時先 grep narrative 的 canonical terms 是否在 entities.jsonl。design_dag_enforcement 4/5 pre-registered → 成本低。Both migrated topics 出 connected=false → 結構性信號：P1b ingest 必須 emit `from=ent-<topic-slug>` outgoing edges，否則 connected concepts 區塊永遠要手寫。這是 N→features 前的準入條件。
- [2026-04-17] [2026-04-17 14:25] **Mechanism finding**: compile-topics `--write` 實跑驗證 — `renderConnectedConcepts` 對 2 migrated topics 回傳 null（因 edges.jsonl 無 `from=ent-<slug>` outgoing），落入「保留人工字串」fallback。Compile 實際唯一做的是 footer timestamp + source_chunks count。

結論：adoption push 方向錯。真正 gate = P1b ingest（從 topic 的 canonical terms + body 結構產 edges）。沒有 P1b，migrate 到 60 topics 也 HIT rate=0。

Task 收斂條件更新：不是「migrate N topics」，是「P1b ingest 跑完，至少 1 topic 的 connected concepts 區塊由 script auto-populate（非手寫）」。
