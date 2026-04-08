Cycle #71 — 跳出連續 3 idle，對 crystallization bridge 做了真正的 mechanism-level 調查

**Finding**：已知的三條 duplicate (priority-misalign/goal-idle/skill-creation-nudge) 都已被現有 gate 阻擋 (NON_MECHANICAL_SIGNALS 或從 signal 生成層移除)。**真正的剩餘缺陷**：dedup 依賴 HEARTBEAT.md 字串匹配 `結晶候選 — ${type}`，但手動歸檔 comment 不保證含此 exact phrase + `crystallizationEscalated` 會被 absence reset 清掉 → 新 signal type 會重演同一 pattern。

**下 cycle action**：
1. `src/pulse.ts` PulseState 新增 `escalatedTypes?: string[]`
2. `escalateToCrystallization()` 末尾 push 到 `state.escalatedTypes`（傳 state 參數進去）
3. Crystallization loop gate 新增 `if (escalatedTypes.has(signal.type)) continue`
4. `markSignalCrystallized()` 從 escalated 移除（移至 crystallized）
5. Test: 寫 pulse.test.ts 測 absence-reset 後不重複 escalate
6. Commit + push

**保持現狀**：B3 TM poll 下 cycle 若無新事件繼續等。HEAD a0272e9 不急 deploy。