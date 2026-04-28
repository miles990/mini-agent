<!-- Auto-generated summary — 2026-04-28 -->
# 2026-04-28-github-fetcher-cron-enrich-integration

本文提案整合 GitHub 趨勢資料進入既有 HN/arXiv 定期抓取管道，核心決策點在於：enricher 整合採最小改動（加 `--source=` flag）、拷貝、或完整重構，以及確認使用 crontab 或 launchd。文件列出三個 falsifier 來驗證分析假設是否正確（enricher 是否已支持參數、GitHub 資料是否已被填充、launchd plist 是否已存在）。
