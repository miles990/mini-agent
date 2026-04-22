<!-- Auto-generated summary — 2026-04-18 -->
# source_lisette_constraint_factorization

Lisette 通過編譯 Rust 語法到 GC runtime (Go) 無意中做了約束分解實驗，展示 Rust 的型別安全層 (L1) 可跨運行時移植，但 Ownership 層 (L2) 的 prescription 在無 ownership 環境中失效。這驗證了 ISC 核心主張：只有底層 convergence condition 存在時，prescription 才能成功移植，否則獨佔資源控制等 collateral benefits 會被靜默丟失。
