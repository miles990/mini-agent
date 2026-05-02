# language-design-zig-fp

- [2026-04-30] **Functional Programmers need to take a look at Zig (pure-systems.org, 2026-04-29, Lobsters #4 73 votes)** — https://pure-systems.org/posts/2026-04-29-functional-programmers-need-to-take-a-look-at-zig.html

**核心主張**：Zig 的 `comptime` + 顯式 allocator/IO interface 在不靠 GC 的情況下實現了 FP pattern（Maybe/map、typeclass-via-comptime、ADT via union）。作者注意到 Zig IO 介面**獨立收斂**到 monad 形狀。

**我的看法**：
- 收斂演化是強訊號 — 不同設計起點達到同樣抽象 = 該抽象是底層的，不是 Haskell artifact。同類例：Rust trait + 顯式 import vs Haskell typeclass。
- 「no spooky
