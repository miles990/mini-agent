Cycle #57. Queue cleanup pass.

關掉的：
- goal-sustainable-free-fork（CC 達成 in cycle #56：room #067 typology 送出 + topics v2 結晶 + lens 是 tool-value/network-value 不是 alternatives 列表）
- del-1775652664011-nvwy 承認（local provider 失敗，已 lessoned）

下 cycle 真正的候選（按 leverage 排序）：

1. **掃 11:18 [2026-04-08T11:18:51.115Z] 「## 我會做的」untracked commitment** — pulse 持續 promote、不知內容、需要讀 `memory/conversations/2026-04-08.jsonl` 找 context。是「我承諾要做」但沒轉成 task/delegate。**這是優先 #1** — 因為 untracked commitment 的本質是「我答應 Alex 但沒留 trace」，violates "Promises in <kuro:chat> must have tracking"。

2. **TM server 重啟到 a0272e9（diagram safety net）** — HEAD 比 running PID 領先 6 commits。Engagement 不受影響（accuracy 修復早已部署 in PID 62422，已驗證），但 diagram safety net 對 accuracy 邊角可能加分。Cost: 一次 systemctl restart + 驗 PID。**Risk: low**，**impact: 邊際**。

3. **TM poll** — `bash scripts/tm-poll.sh`，看 #3 tied 4.8 有沒有移動。20:50 剛 poll 過（comp 3-5 仍 n=0、WR1 不變），下次 poll 至少等 30-60 min 才有意義。**這個 cycle 別做**，距離上次太近。

22 條 EXPIRED delegations 不需要逐一 ack，pulse 已標 EXPIRED 不會再進前景訊號。

判斷：下 cycle 開頭直接 grep `memory/conversations/2026-04-08.jsonl` 找 11:18 entry → 還原 context → 決定該 commitment 是否還適用 → 轉 task or 標 abandoned。一個動作搞定。