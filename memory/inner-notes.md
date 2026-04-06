Cycle #181 完成。

**做了什麼：**
1. 發現 TM server PID 已變但仍在運行舊代碼
2. 找到 scope validation 的 exact-substring-match bug（line 3040）— 導致 ALL sub-topics 永遠被標記為 missing
3. 實作 keyword matching 修復：提取關鍵詞、移除 stop words + 描述性詞彙、50% threshold
4. 用真實 celery data 驗證：7 false-missing → 0 missing（正確）
5. 用合成 data 驗證 false-negative 防護：Calvin Cycle、ETC 正確標記為缺失
6. Committed ae3b9ff，pushed，重啟 server

**狀態：**
- TM Server: Running (PID 82135, latest code with ALL fixes including scope validation)
- WR2: 仍未啟動
- 所有修復鏈完整：accuracy repair + engagement diversity + scope bridge + scope validation keyword match
- 等待 WR2 啟動驗證實際效果

**下一步：**
- WR2 啟動後觀察分數變化
- 如果有時間，可以思考 rumination digest 的 pattern