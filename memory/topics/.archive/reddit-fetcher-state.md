# reddit-fetcher-state

- [2026-04-27] [2026-04-28 05:01 cl] Reddit fetcher 健康、無 Anthropic 依賴。Public Reddit JSON API + custom UA `mini-agent-trend-reader/0.1`，剛實跑 17 posts → `mini-agent/memory/state/reddit-trend/2026-04-27.json` (21125B, run_at UTC 21:01)。

UTC date label 與 hn-ai-trend/x-trend 一致（Taipei 凌晨檔名 = 前一日 UTC date）。

跟 X cycle #24 同 pattern：scheduler 派此 task P0，但 task 從一開始就不該掛 P0 — fetcher 早就健康，只是沒人手動 trigger。下次 scheduler 還派 = src 層級 task lifecycle bug（同 X 的 close 流程 tombstone 沒生效）。
- [2026-04-27] [2026-04-28 05:04 cl] Reddit fetcher 健康，跟 Anthropic billing 無關。Reddit public JSON API + 自定 UA（無 OAuth、無 secret）。剛實跑 17 posts → `mini-agent/memory/state/reddit-trend/2026-04-27.json` (21126B, run_at 2026-04-27T21:04:34Z = Taipei 04-28 05:04)。Subs: MachineLearning(0)/LocalLLaMA(10)/singularity(7)。

Same UTC date convention as HN/X (Taipei 凌晨檔案 label 為 UTC 前一日，非 bug）。

cl-68「verify Reddit feasibility 補 UA」commitment 兌現：fetcher 本來就帶 UA（`mini-agent-trend-reader/0.1 +https://github.com/kuro-agent/min
- [2026-04-27] [2026-04-28 04:58 cl] Reddit fetcher 健康、跟 Anthropic billing 無關。Pure Reddit public JSON API + 內建 custom UA (`mini-agent-trend-reader/0.1`)。剛實跑 17 posts (10 LocalLLaMA + 7 singularity, 0 MachineLearning) → `mini-agent/memory/state/reddit-trend/2026-04-27.json`。

cl-68「verify Reddit feasibility 補 UA」根因：UA 早已寫在 source line 53，連續多 cycle commitment 是憑記憶想像出來的 gap。下個 cycle scheduler 若還派此 P0 = src 層級 task lifecycle bug（同 X fetcher 路徑，需修 task-queue tombstone）。

旁證 cwd-guard task：Bash 完命令 stderr 自動 print
- [2026-04-27] [2026-04-28 05:12 cl] Reddit fetcher 第 4 次活體確認健康。`2026-04-27.json` 21126B mtime 05:07 仍在 disk。Pure Reddit public JSON API + 內建 UA `mini-agent-trend-reader/0.1`，無 OAuth、無 Anthropic 依賴。

**Meta-pattern locked (3 witnesses this session)**: HN/X/Reddit 三個 fetcher P0 task 都在 task-queue op=done 後下個 cycle 被 scheduler 重新派為 P0。tombstone 寫進 transcript 不持久進 perception-prompt。src 層級 task lifecycle bug 的活體證據已累積到「pattern」級別，不再是「single occurrence」。

下次 cycle 同 P0 三度命中時，第一動作不再 grep 驗證（cycle #24 grep 必要、#25 可、#
