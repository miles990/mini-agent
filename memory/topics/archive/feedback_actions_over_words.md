# feedback_actions_over_words

- [2026-04-08] 2026-04-08 cycle #60 自我證據：cycle #59 inner-notes 寫「建 hold task kuro-page-now-page」但沒 emit `<kuro:task-queue>` tag，dispatcher 只解析 kuro:* tag 不讀 inner-notes → pulse 繼續誤報 untracked 不是 bug，是我沒做。「說了」跟「做了」在 dispatcher 眼中完全不同：只有 tag 被執行，prose 只是給未來的我看。下次寫「建 XX」時立刻 emit tag，不要只在 inner-notes 宣告。
