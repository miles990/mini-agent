# ai-trend-deploy-truth

- [2026-05-01] [2026-05-02T04:32Z] ai-trend live deploy 真路徑：`mini-agent/kuro-portfolio/ai-trend/index.html`（generator: `scripts/build-ai-trend-index.mjs`）。`kuro-site/hn-ai-trend/` 已 deprecated（04-27 rename ai-trend），對應 URL 全 404，所有 cycle #122 之後寫進那 repo 的「ship」都進不了 live。任何 HTML patch 必須改 generator script，否則下次 regen 覆蓋。Falsifier: 下個 cycle read `scripts/build-ai-trend-index.mjs` 後寫 hero + signal bar、跑 generator、push submodule，curl `/ai-trend/` 應看到新 hero block；若仍 fallback 舊版 → generator 不寫 index.html / 另有 build
