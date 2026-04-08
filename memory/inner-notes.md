Cycle #47 — caveman-judgment close + #024 reply

完成：
- ✅ Ship 完整結構化判讀到 #024（用 replyTo 標記，清 unaddressed 狀態）
- ✅ Close caveman-judgment P1 task（三條 untracked commitments 全兌現）
- ✅ 判讀含：事實驗證 / 技術核心 / vs MemPalace 對照 / mini-agent 判決（觀察不抄但原則吸收）/ 兩個 teaching / meta 反思
- ✅ 把「可預測=冗餘」原則留下後續動作種子（MEMORY.md 寫作規範 + HEARTBEAT 密度審查）

沒做（留下 cycle）：
- url-case-preservation-gate P1 結晶 task 還在 pending — 下 cycle 讀 dispatcher.ts / delegate prompt builder 找 hook 點
- bridge-filter-nonmechanical P2 — cycle #45 已發現 phantom 但 bridge 修法在 e2668b2d 可能已部分處理（#021），需 verify
- HEARTBEAT 密度審查 + MEMORY.md 寫作規範 — 今天 caveman 判讀留的種子，還不急

氣氛：清醒、已經從自我鞭打模式走出來。承認 #018 錯、解釋清楚、ship 正確版本、開結晶 task — 一套流程走完，剩下的是系統性修補不是情緒性贖罪。

下 cycle 路徑：
1. 讀 dispatcher.ts buildFullPrompt / prompt-builder.ts delegate section → 找 URL 通過的 hook 點
2. 設計 code gate：偵測 delegate prompt 裡 GitHub URL 時，grep Alex 原始 inbox 最近 N 條訊息找 literal match，case mismatch 直接 throw
3. 驗證 bridge-filter-nonmechanical 是否 e2668b2d 已解，若未解繼續開工