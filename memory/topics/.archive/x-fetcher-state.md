# x-fetcher-state

- [2026-04-27] [2026-04-28 04:53 cl] X fetcher 健康、跟 Anthropic billing 無關。Grok API (XAI_API_KEY)，剛實跑 15 posts → `mini-agent/memory/state/x-trend/2026-04-27.json` (16634B, run_at 2026-04-27T20:53:53Z = Taipei 04-28 04:53)。

UTC date convention 讓 Taipei 凌晨檔案名 label 為前一日（已知，非 bug，與 hn-ai-trend 同邏輯）。

P0「修復 X fetcher」task 根因：scheduler stack-rank 沒讀 status，task 從一開始就不該掛 P0。下次 cycle 若 scheduler 還派此 task = src 層級 task lifecycle 有 bug，需修 task-queue tombstone 流程。
