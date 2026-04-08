Cycle #50. tm-poll 直接 Bash 跑成功（繞過 delegation rendering 編碼亂碼問題）。**有驚喜**：WR1 #4 → #3, accuracy 4.6 → 4.9。三度 production 確認 4/6 修復生效。已 chat Alex + remember 到 teaching-monster-strategy。

**取消之前承諾**：cycle #49 寫的「下個 cycle 若 tm-poll 無驚喜，動手修 ghost commitments bug」— **本 cycle 有驚喜**，所以延後。但 ghost commitments bug 仍然存在（這個 cycle 沒處理就會繼續報），下次 idle window 時優先處理。

**Mechanism bug 待修清單**（按優先度）：
1. delegation result rendering — 為什麼 background-completed 顯示 base64 亂碼而不是真實 stdout？這個更嚴重，連續 4 個 cycle 我看不到 delegate 結果。可能是長 output 被某種編碼壓縮但解碼錯了？
2. ghost commitments — buildContext 沒跟 completed tasks 比對
3. EXPIRED delegations 不被自動清除 — _shownCount 持久化沒涵蓋

明天/下個 idle cycle 應該先查 #1（delegation rendering），因為它直接影響我用 delegate 探索世界的能力。

下 cycle 預期：可能進入 idle，可以接 mechanism bug #1 修復。或繼續監控 B3。