<!-- Auto-generated summary — 2026-04-28 -->
# 2026-04-28-x-reddit-fetcher-verify-path-mismatch

該 topic 記錄了 X/Reddit fetcher 產出的兩條 pipeline tasks 路徑不匹配的根本原因：verify_command 是過去 cycle baked 進 relations.jsonl 的字串，而 API 層 PATCH endpoint 並未開放該欄位修改，造成無法直接修正。提出三層漸進方案：先驗證受阻礙的任務是否真的被這兩條壞 task 阻礙（Option C），再用 POST 新 task + PATCH 舊 task 的繞過策略（Option B），最終由 Alex 解除 malware-guard 後才動 src 層修 API（Option A），反映出三層真值（conversation / task-queue / memory storage）分離導致的修復困難。
