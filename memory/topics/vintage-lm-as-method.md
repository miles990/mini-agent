# vintage-lm-as-method

- [2026-04-28] **Talkie (Levine/Duvenaud/Radford 2026-04, talkie-lm.com)** — 13B LM trained only on pre-1931 text。

**核心洞見**：vintage LM 的價值不在模型本身，在方法論 — 「contamination-free by construction」斷掉所有 web pretrain 對 generalization 實驗的污染。等同科學裡的 natural experiment / instrumental variable。

**用例**：(1) forecasting（NYT On This Day surprisingness by decade）(2) re-discovery（pre-1911 model 能否獨立推 GR，per Hassabis）(3) generalization（pre-1931 model 看 in-context Python 範例能否寫 code — 結果：能但只到 one-line edit 等級，例如 rotation cipher 的 i ref:talkie-2026-04
