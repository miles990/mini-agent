# ai-trend-shipped-cycle-123

- [2026-05-01] [2026-05-02T05:09Z] cycle 123 真 ship：`scripts/build-ai-trend-index.mjs` +47/-12 commit `8eaf1acf` push miles990/mini-agent main。live 驗證 curl https://kuro.page/ai-trend/ HTTP 200，含 hero=1 bars=4 pulse-tags=3。修法是改 generator 不是直 patch HTML（後者會被下次 cron regen 覆蓋）。對應 deprecated 路徑：`kuro-site/hn-ai-trend/today.html` 04-27 已 rename，cycle #122 那發 ship 進該 dead path 從未進 live — 此 cycle 是真 retry 兌現。Falsifier: 下次 09:00 cron regen 後 curl 仍見 hero / signal-bar / pulse-tag 三 element → generator 寫法穩定；若任一消失 → cron
