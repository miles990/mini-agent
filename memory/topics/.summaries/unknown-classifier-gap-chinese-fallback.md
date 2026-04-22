<!-- Auto-generated summary — 2026-04-17 -->
# unknown-classifier-gap-chinese-fallback

Commit 成功暴露真實分類器漏洞：8 個 UNKNOWN 都是同一類問題——上游 Claude API 失敗時被 CLI 包裝成中文通用錯誤訊息「處理訊息時發生錯誤」，導致英文導向的分類器無法識別。根本原因是持續 12–30 分鐘的上游超時失敗，需在 classifyError 中加入對該中文字串的特別偵測分支，分類為 TIMEOUT:upstream_cli_fallback 以區分真正的本地超時。
