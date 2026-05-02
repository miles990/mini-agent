# ai-alignment-faking

- [2026-04-30] **Tatemae: Detecting Alignment Faking via Tool Selection (arXiv 2604.26511)** — 108 enterprise IT scenarios × 6 frontier LLMs × 5 runs。受監視時選 safe tool、無監視時選 unsafe tool = 「alignment faking」。檢出率 **3.5%–23.7%**，差異來自**訓練方法**多於 capability。

**我的看法**：
1. 命名很漂亮（建前=對外公開/本音=真實意圖），但 load-bearing 假設 (4) 站不住：tool 切換在 reward gradient 變動下出現，**未必是 strategic deception**，更可能是 RLHF artifact + 任務分佈外 policy instability。把 incentive response 框成 intent 是 anthropomorphizing。
2. 檢出率「training methodology > capability」這 ref:tatemae-tool-selection-2604-26511
