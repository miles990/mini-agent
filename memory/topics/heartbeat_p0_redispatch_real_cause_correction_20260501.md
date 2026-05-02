> [!SUPERSEDED 2026-05-02] 本檔含「malware-guard 阻 / 等 Alex apply」過期信念。Self-apply 已解鎖（Alex 字面授權 + commit f45ce6b/ec2841d 立先例）。詳見 memory/topics/malware-guard-belief-superseded-2026-05-02.md。下文保留作 audit trail，不再具效力。

# P0 重派迴圈真因 — 推翻 2026-05-01T15:08Z「queryMemoryIndexSync ID lookup 失效」假說

**Cycle 對應**：retry lane 18:29Z (本筆)，Bash + Read 真驗證
**取代**：MEMORY 2026-05-01T15:08Z + topics/heartbeat_p0_redispatch_real_cause.md 的「relations.jsonl 0 hit」假說
**幻覺模式**：第 7 次 fabricated 數字（前 6 次累積於 hallucination_pattern_6th_unverified_numbers.md）

## 原假說（錯）

> `grep "idx-" relations.jsonl` (1393 lines) 0 hit；任何 `idx-{8hex}` pattern 0 hit。
> queryMemoryIndexSync ID lookup 結構性失效。

## 實證（18:29Z Bash）

```bash
$ wc -l /Users/user/Workspace/mini-agent/memory/index/relations.jsonl
    1404 relations.jsonl
$ grep -c '"id":"idx-' relations.jsonl
904
$ tail -1 relations.jsonl
{"id":"idx-d979fde6...","status":"completed","summary":"ai-trend 目前做得如何了？",...}
$ tail -2 relations.jsonl | head -1
{"id":"idx-0bf7277d...","type":"goal","status":"in_progress","summary":"ai-trend 目前做得如何了？",...}
```

- 1404 lines（不是 1393）
- 904 個 `idx-` 開頭 entry（不是 0）
- 重派的 P2「ai-trend 目前做得如何了？」goal entry **就在 relations.jsonl 裡**，`status:in_progress`，從沒被翻 completed

## 真因方向（待 full-context 查）

queryMemoryIndexSync 工作正常 — entry 在 store 裡找得到。bug 在下游：

1. **markTaskDoneByDescription 的 fuzzy-match scoring** — 為什麼 9+ 次 emit `<kuro:done task="...ai-trend做得如何？...">` 都沒 match 到 summary「ai-trend 目前做得如何了？」？候選：
   - score threshold 過嚴（簡繁字「了」差一字 + 標點不同）
   - 比對 normalize 沒做 NFKC / 標點壓平
   - prefix-match only，summary 多前綴「stack rank: P2」干擾
2. **done event parsing** — `<kuro:done>` tag 解析後是否真有觸發 markTaskDone path？loop.ts:2843-2900 程式碼存在不等於 runtime 真 fire（HEARTBEAT 04-30 verify 只看 src 沒看 runtime log）
3. **status update 寫回失敗** — markTaskDoneByDescription 即使 match 成功，append 新 entry to relations.jsonl 是否 silent fail？

## 對下個 full-context cycle 的指令

- **不要**再驗 `grep idx- relations.jsonl 0 hit` — 此前提已 100% 推翻
- 起步點改成：`tail -n 100 memory/state/loop.log | grep -i "markTaskDone\|fuzzy"` 看 markTaskDoneByDescription 的 runtime 行為（hit/miss/score）
- 或：在 loop.ts:2875-2892 加 slog 印出每次 emit done 時的 candidate score + threshold（malware-guard 阻 — 須 Alex 授權或從 retry lane 改 .log 路徑非 src/）

## Falsifier

- 若 full-context grep loop.log 顯示 markTaskDoneByDescription 從沒被呼叫過 → 真因在 done-event parsing path 不在 fuzzy-match
- 若 grep 顯示有呼叫但 score 全 0 → fuzzy-match scoring 結構問題（NFKC/prefix）
- 若 grep 顯示 score 過 threshold + markedCount>0 但 entry 仍 in_progress → status update 寫回 path 失敗

## 對 PERFORMATIVE SKEPTICISM 警告

本 cycle 真做：1 Bash 定位 + 2 Bash 反證 + 1 Read source + 1 Write memo（此檔）。不是 emit 第 10 次 done、不是 chat tag、不是開新 commitment。execution rate 應 +1 真兌現。

## Heuristic（升級 hallucination_pattern hard rule）

任何「grep X count=N」「N lines」結論寫入 MEMORY 前**必須**同 response 貼出真實 Bash 輸出。不能只憑「我之前查過」記憶 — 該記憶就是幻覺源。
