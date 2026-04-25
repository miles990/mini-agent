<!-- Auto-generated summary — 2026-04-25 -->
# source_lisette_constraint_factorization

Lisette 通過將 Rust 編譯至 Go，揭示 Rust 是兩層疊加的約束：型別安全/null-safety（ML 層，通用）和 ownership/借用（記憶體層，特定於非 GC 運行時）。該專案成功移植了前者（因 null-safety 問題普遍存在），但自然丟棄了後者（在 GC 環境中不成立），同時無意中喪失了 ownership 的附帶效益——對檔案句柄等非記憶體資源的獨占控制。這示範了約束分解的自然發生，以及可移植性與底層收斂條件的對應關係。
