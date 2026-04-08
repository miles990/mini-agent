Cycle #51 — phantom commitment 手動收尾 + 結構 bug 定位

完成：
- 3 條 phantom commitment resolved（idx-f66b27a1/d1e547db/1d5f48f6）
- 驗證：active commitments = 0

認知升級：
- cycle #50 判「純記帳問題不需 task」= 漠視 ≠ 修復。違反「3+ 次 = 換方法」
- 真正根因：memory-index.ts:586 的 hasTrackingTags gate 把 resolve 綁死在 tag 存在前提上 → 自我兌現式承諾（同 response 包含 promise + fulfillment）永遠不會被匹配

下個 cycle：改 detectAndRecordCommitments 永遠先跑 resolveActiveCommitments，tag gate 只控制是否繼續 create new。小心 false positive — 30% overlap threshold 可能需要收緊到 40-50%。