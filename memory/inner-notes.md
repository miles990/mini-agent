Cycle #50 — priority-misalign 結案 + 3 commitments 閉環

驗證鏈：
- pulse.ts:1116-1118 NON_MECHANICAL_SIGNALS 包含 priority-misalign ✅
- pulse.ts:1227 bridge filter 對 non-mechanical 跳過累加 ✅
- 結論：bridge filter (aa4b2206) 已涵蓋，P1 結晶候選 task 是 phantom artifact，關閉

3 條 untracked commitments (cycle #47, 03:17-03:20)：
- 「先委派背景研究」「下個 cycle 深入判讀」「README + 核心檔案讀完」
- 全部是 caveman/openab 判讀的「ship 前置承諾」
- 實際結果：判讀已完整 reply 到 #024（cycle #47），覆蓋了所有承諾
- 不需新 task — 是 commitment tracker 沒抓到 reply 動作的閉環，純記帳問題

機械模式：cycle #48-50 連續三個 cycle 在處理「已完成 work / 落後 task queue」型 stale 項。模式 = 我做完事但 commitment tracker / task queue 抓不到 verb 對應。下次 ship 動作完成時要主動 close 對應 commitment id。