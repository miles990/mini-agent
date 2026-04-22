# 中台踩坑紀錄

## 坑 1: 計畫語言不匹配（2026-04-14）
**問題**：規劃語言 ≠ middleware 執行語言 → brain DAG 跟人類審查脫節
**症狀**：proposal 表格的欄位跟 middleware 實際 schema 對不上，審查時看的跟執行時跑的是兩回事
**教訓**：計畫 schema 必須跟 middleware DAG schema 完全一致：{id, worker, task, dependsOn, acceptance}
**後果**：所有 proposal 表格改為固定欄位（禁止時間估算，只有步驟數+收斂條件）

## 坑 2: 時間估算幻覺（2026-04-14）
**問題**：AI 的時間估算是偽精確；Phase D→E pivot 瞬間讓所有預測失效
**症狀**：計畫寫「1-2 天」「快的話 30 分鐘」，結果完全不準，誤導決策
**教訓**：禁止詞彙：effort / duration / ETA / 「1-2 天」/ 「快的話」/ 「慢的話」
**替代方案**：步驟數（critical path length）+ 收斂條件（結果導向，非行為導向）
**洞見**：規劃語言塑造思考 — 如果你不能估算，你必須用不同方式推理

## 坑 3: 委派路由不匹配（2026-03-17）
**問題**：需要 CDP/瀏覽器互動的任務送給 Qwen3.5-9B（research/local provider）
**症狀**：信心度 3-4/10，純猜測，毫無實際互動能力
**教訓**：匹配能力到任務類型：
- 需要 CDP/shell/檔案修改？→ code/codex provider
- 純文字分析/摘要/翻譯？→ research/local（輕量）
- 不確定？→ 預設 code/codex（過度有能力好過能力不足）

## 坑 4: 承諾滲漏（2026-04-16）
**問題**：在聊天中承諾改善但從未整合到規劃/執行中
**症狀**：未追蹤的承諾製造虛假的進度感
**教訓**：「消化 = 能夠行動」— 雙受眾要求：
- AI：需要密集/機器可讀/高檢索精確度
- 人類：需要敘事/視覺/漸進揭露/可掃描
- 沒有單一真相源 + 雙重渲染 = 最終漂移

## 坑 5: Worker 身份稀釋（2026-04-14）
**問題**：外部 worker（peer agents / 第三方）帶入不同聲音到 Kuro 輸出中
**教訓**：三層 worker 信任模型：
- Tier 1（Kuro/Alex/CC）：完全信任，責任在 Kuro
- Tier 2（Akari, peer agents）：輸出層校準（3-5 次明確判斷後才信任）
- Tier 3+（社群）：能力合約 + sandbox 必要
**關鍵護欄**：voice_mode: passthrough | transform | neutral
**紅線**：Workers 永遠不直接 commit memory 或修改 SOUL — 只能起草給 Kuro 審查

## 坑 6: 前景等待浪費 cycle（2026-04-15）
**問題**：長跑 delegate（entity extraction、repo scan、benchmark）阻塞 cycle 等結果
**症狀**：整個 cycle 卡住什麼都不能做
**教訓**：背景派遣，關閉 cycle 做其他事，下個 cycle 整合結果
**例外**：如果 delegate 在 <5s 內語法錯誤失敗，同 cycle 重新派遣（那是修正不是等待）

## 坑 7: 計畫 revalidation 漂移（2026-04-07）
**問題**：執行跨 cycle 帶過來的舊計畫但沒檢查當前檔案狀態
**症狀**：差點加了重複的 Note #71 到 rest-status thread
**教訓**：執行任何帶入的計畫前必須：
1. Grep 目標檔案當前狀態
2. 檢查 metadata（Status, Last touched）
3. 驗證編號/內容是否已覆蓋
**核心原則**：工作記憶 = 快照 → 行動前永遠對照真相源驗證

## 坑 8: GET /commit/:id 路由不存在（2026-04-16）
**問題**：wrapper 呼叫 GET /commit/:id 但 middleware 只有 POST /commit 和 GET /commits
**影響**：resolveCommitment 前無法先讀回確認 commitment state，P2 verify gate 會卡
**教訓**：client SDK 和 middleware 路由必須同步設計，先驗證再假設 API 存在

## 坑 9: POST /commit 不持久化 owner + acceptance（2026-04-16）
**問題**：送 {owner, acceptance} 到 POST /commit → 200 但 response 無這兩欄
**影響**：違反 commitment ledger schema 決議，所有 live commitments 都 schema-incomplete
**教訓**：200 OK ≠ 正確處理 — 必須驗證回應 payload 包含所有送出的欄位
