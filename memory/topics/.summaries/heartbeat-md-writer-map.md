<!-- Auto-generated summary — 2026-04-30 -->
# heartbeat-md-writer-map

HEARTBEAT.md 是 mini-agent 系統的中央狀態紀錄源頭，由多個 writer（cycle-tasks.ts、memory.ts、feedback-loops.ts 等）維護，負責 TTL 衰減、垃圾清理、任務更新與錯誤升級。該檔案被多個 reader（search.ts、dispatcher.ts、omlx-gate.ts 等）用於做決策，特別是透過 content-hash skip-gate 機制避免不必要的 LLM 呼叫。整體形成一個統一的工作狀態管理中樞。
