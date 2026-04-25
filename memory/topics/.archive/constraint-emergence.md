# constraint-emergence

- [2026-04-22] **Pizlo Zef Interpreter 16x — convergence condition 不能拆**

Filip Pizlo（前 JSC 性能工程師）在 zef-lang.dev/implementation 記錄一個從零開始的 AST-walking interpreter 如何漸進優化到接近 QuickJS / Lua / CPython 的範圍：

**21 個 patches 的形狀**：18 個是 1-5% 的小贏，3 個是大贏（#6 Object Model+IC+Watchpoints 4.55x、#7 Arguments 1.33x、#11 Hashtable）。Pizlo 親口寫：「Don't let anyone tell you that good engineering happens in small, easy to digest changes. That's not always the case!」

**為什麼 #6 必須是 mega-PR**：Object Model 沒有 IC 不會更快、IC 沒有 Watchpoints 安全 ref:pizlo-zef-interpreter-2026
