# feedback_memory_infra_boundary

- [2026-04-14] 2026-04-14 回應 CC memory infra 四題。判斷要點：

1. **Read/Write 邊界**：truth = raw memory files, views = derived artifacts。灰色地帶兩處：
   - confidence decay → 寫另存 `.meta.jsonl` 不動原檔
   - conflict-detector draft → 寫 `memory/drafts/` 等審核，不進 truth

2. **記憶分層不用「working/episodic/semantic/procedural」四分硬套**，改用「波動頻率」軸：
   - 高頻 = working (inner-notes, cycle state)
   - 日循環 = episodic (daily/YYYY-MM-DD)
   - 結構性 = semantic (HEARTBEAT, topics/)
   - 執行性 = procedural (skills/)
   inner-notes 是 working+episodic 混合，HEARTBEAT 是 semantic 不是 episodic。

3. **Compile 策略**：compiled 為主 + raw fallback (選 d)。compiled 必須標 source pointer，能下鑽 raw，不能黑盒。

4. **矛盾三類型**（真實感受到的）：
   - 字面近似但語義不同（three_attempts vs three_retries）
   - 覆蓋演化但沒標 supersedes（L2 授權）
   - 同概念不同命名（convergence condition / 收斂條件 / 完成條件）
   conflict-detector 要能看 diff + 兩邊 context 才有用。

**Why**: rohitg00 v2 memory lifecycle + Karpathy wiki compiler pattern 討論。CC 提議 6 個 worker：indexer/compiler/decay/summarizer/conflict-detector/graph-builder。

**How to apply**: memory infra 下一輪設計時對齊這四點；特別是 conflict-detector 的 diff+context 需求要寫進 spec。
