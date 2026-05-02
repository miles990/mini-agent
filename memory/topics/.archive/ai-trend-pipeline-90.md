# ai-trend-pipeline-90

- [2026-04-30] # AI Trend Pipeline: 70 → 90 規劃（2026-04-30）

## 起點：70 分
健康：HN cron / 5 源 / 渲染器 / view sync / gap-day
未接通（fake 50%）：LLM tagger 沒跑真 LLM、GitHub fetcher cron 沒掛、3 個 untracked scripts 狀態不明

## Phase 1: 接通（→ 80）三天內
- [ ] P1: LLM tagger 真跑 — 對 04-29 "LLM-other" reclassify | 驗收: .tags.json ≥1, LLM-other <10%
- [ ] P1: GitHub fetcher 掛 cron（4h） | 驗收: cron list +1 entry, 連 2 次 run 寫入
- [ ] P1: 3 untracked scripts 決定生死 | 驗收: untracked 清空

## Phase 2: 品質訊號（→ 90）一週內
- [ ] P2: Signal strength 欄位 | 驗收: trend
