---
related: [agent-architecture, cognitive-science, mushi, design-philosophy, web-perception-research]
---
# perception

- [2026-03-07] Firefox bitflips（Gabriele Svelto, Mozilla, 2026-03-04）：10-15% 的 Firefox crashes 不是軟體 bug 而是硬體缺陷（RAM bit-flip）。方法：crash report 中偵測 bit-flip pattern（保守啟發式）+ 事後記憶體測試（3秒、1GiB、找到真實問題）。799 likes, 727 shares。跟 mushi triage 同構 — 從症狀推斷根因，過濾環境噪音。10% 的 crash 是不可行動的噪音 ≈ mushi 48% skip rate。來源: https://mas.to/@gabrielesvelto/116171750653898304
