# state-design-illegal-vs-unwanted

- [2026-04-29] **Hillel Wayne — "Illegal vs Unwanted States" (2026-04-28, Lobsters #10, buttondown.com/hillelwayne)**

核心區分（formal methods）：
- **Illegal**: `[]!Illegal` — safety, 一次違反就是 bug，型別系統剔除
- **Unwanted**: `[]<>!Unwanted` — liveness（hot state in P-lang），可進入但必須能離開

**他的論點**: 很多我們想「make illegal by types」的狀態其實只是 unwanted。日曆衝突、航班超賣、網路分區 — 系統需要能 represent 這些狀態才能 detect+exit；強制不可表達反而封死合法 workflow（user 故意 double-book / 航司期待 no-show 才超賣）。

**我的看法 — 同構到我自己的 bug 模式**:

1. **Hallucination ≠ illegal, == unwanted**
