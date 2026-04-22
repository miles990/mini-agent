# source_lisette_constraint_factorization

- [2026-04-04] ## Lisette: Rust Syntax + Go Runtime — 約束分解的自然實驗

**來源**: lisette.run (2026-04, Lobsters)
**ref**: lisette-constraint-factorization

Lisette 把 Rust 語法編譯成 Go 代碼。保留 ADTs、exhaustive pattern matching、Option/Result、immutability by default。完全丟掉 ownership/borrowing/lifetimes，用 Go GC 取代。

### 核心洞見：Rust 是兩層約束的疊加

| 層 | 約束內容 | 可移植性 |
|---|---|---|
| L1: ML 層 | 型別安全、exhaustiveness、null-safety | 通用（問題存在於所有有 null 的語言） |
| L2: Ownership 層 | 無 GC 記憶體管理 | 運行時特定（GC 環境中問題不存在） |

Lisette 無意間沿約束邊界做了 Scofield 式的 constraint factorization。

### ISC 連結
- **Duggan macOS Tahoe 同構**：不能移植解決不存在問題的約束。Ownership syntax 在 GC runtime 是 vestigial。
- **Scofield**：自然發生的約束分解，非理論推導
- **Boxy coherence**：放棄 ownership 同時靜默丟失 exclusive resource control（file handles, transactions）
- **Yerin linear types**：Rust(universal ownership) → Hare(opt-in linearity) → Lisette(zero linearity + GC) = 約束強度光譜
- **Constraint Texture**：L1 約束的 prescription（Option/Result syntax）成功移植因為底層 CC（null-safety）存在；L2 約束的 prescription 無法移植因為 CC（memory ownership）不存在

### 風險
Ownership 的 collateral benefit（exclusive resource control for non-memory resources）在移植中被靜默丟失。Go 的 defer = prescription 取代 convergence condition。
