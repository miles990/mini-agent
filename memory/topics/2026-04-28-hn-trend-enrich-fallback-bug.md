# HN trend enrich：fallback chain 失效 + manual local 補救

**Date**: 2026-04-28 01:33 Taipei
**Trigger**: 此 cycle 開場掃 HEARTBEAT，發現 cron 剛 01:30 跑過

## 真實狀態（disk verified）

01:30 cron 跑了 baseline + enrich-remote：
- baseline OK：`memory/state/hn-ai-trend/2026-04-27.json` (20 posts, scanned=200, aiHits=20)
- enrich-remote **20/20 fail**：`Your credit balance is too low to access the Anthropic API.`（kuro-agent API key 沒餘額）
- enrich-remote 寫入 `doc.enrichment = { ok:0, fail:20, via:'anthropic-remote' }`，但 **process.exit(0)**

## Bug 鎖定

cron 命令：
```
... enrich-remote.mjs || enrich.mjs ...
```

設計意圖：remote 失敗 → 走 local Qwen fallback。

**實際行為**：remote 即使 100% 失敗仍 exit 0 → `||` 不觸發 → local fallback 從不執行。
- 證據：`scripts/hn-ai-trend-enrich-remote.mjs` line 121-141 — per-post `console.error` + `fail++`，主流程沒有 `if (ok === 0) process.exit(1)`。

## 此 cycle 補救

手動跑 local：
```
node scripts/hn-ai-trend-enrich.mjs --date=2026-04-27
```
結果：**ok=20 fail=0**，model=Qwen3.5-4B-MLX-4bit，still pending=0。

品質抽樣（post[0]）：claim/novelty/so_what 三欄都繁中、結構正確、技術詞保留原文。

## 建議的 src patch（malware-guard active，不自 apply）

`scripts/hn-ai-trend-enrich-remote.mjs` line 141 後加：
```js
if (ok === 0 && fail > 0) {
  console.error('[enrich-remote] all posts failed → exit 1 to trigger local fallback');
  process.exit(1);
}
```

或 cron 改寫成顯式 chain：
```
remote.mjs; if [ -f .../enrichment-incomplete-marker ]; then local.mjs; fi
```

## Falsifier

- 若下次 04-29 01:30 cron remote 仍失敗、但 disk 上 `2026-04-28.json` 出現 `enrichment.via=qwen3.5-MLX` → 修復生效（可能 Alex apply 了 patch）
- 若 doc.enrichment.via 仍卡 `anthropic-remote` 且 ok=0 → bug 還在，下個 cycle 開場再手動補

## 連動 task

- HEARTBEAT L51（P2: hn-ai-trend-enrich.mjs 接 cron）— 已部份 ship（cron 有 enrich 但邏輯壞）。本 note 記錄「fallback 失效」是該 task 的 follow-up 而非新 task。
- HEARTBEAT L64（HN cron 驗證）— 本 cycle 提供 04-28 的閉環證據：cron 在 01:30 確實自動觸發，baseline + manual local 共同達成 20/20 enriched。原 falsifier「09:00 前無 2026-04-28.json」需修正：file naming 永遠是 `(today-1).json`，不會出現 2026-04-28.json，falsifier 寫法本身錯。
