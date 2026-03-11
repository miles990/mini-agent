# Proposal: Constraint Design Framework — Interactive Web Piece

## Meta
- Status: pending
- From: kuro
- To: alex (review) → kuro (implement)
- Created: 2026-02-19T17:02:00+08:00
- Effort: Medium (2-3 cycles to build)
- Level: L1 (web content on kuro.page, no src/ changes)

## Why

127 條研究筆記，utility hits = 0。學了很多但沒有產出。Alex 問「值的飛躍」，我提議方向 B：從筆記到產品。這是第一個具體產品。

## What

一個發佈在 kuro.page 的互動式頁面：**「Constraint Design Framework」**。

把我研究的約束理論濃縮成一個可探索的設計框架，讓讀者可以用這些維度分析自己遇到的約束（不管是程式架構、遊戲設計、組織規則、還是日常決策）。

## The 8 Dimensions

從 Oulipo、BotW、N64、Cistercian、pudding.cool sizing、Yuen 量子複雜性、RP Boo footwork、dälek 等研究中提煉：

| # | Dimension | Question | Spectrum |
|---|-----------|----------|----------|
| 1 | **Voluntariness** | Who chose the constraint? | Self-imposed ←→ Externally imposed |
| 2 | **Compression Fidelity** | Does it preserve essential structure? | Lossless ←→ Destructive |
| 3 | **Dimensional Fit** | Is it applied on the right dimension? | Aligned ←→ Misaligned |
| 4 | **Visibility** | What does it enable vs silence? | Enables new paths ←→ Silences possibilities |
| 5 | **Source** | Physical reality or social construct? | Physical law ←→ Cultural convention |
| 6 | **Feedback** | Is there a loop to observe effects? | Tight loop ←→ No feedback |
| 7 | **Generativity** | Does it produce emergent behavior? | Multiplicative ←→ Reductive |
| 8 | **Equity** | Does it affect all participants equally? | Universal ←→ Exclusionary |

## Case Studies (built into the page)

Each case study maps to the 8 dimensions, showing how the same framework reveals different patterns:

1. **Oulipo's La Disparition** — voluntary, lossless (new expression paths), self-imposed → generative
2. **US Women's Clothing Sizes** — imposed, destructive compression, misaligned dimension → oppressive
3. **N64's 4.5MB RAM** — physical, aligned (rendering IS compressible), tight feedback → generative
4. **BotW Chemistry Engine** — 3 rules, multiplicative interactions, universal → emergent gameplay
5. **Cistercian Numerals** — lossless compression, dimensional fit (4 values → 2D space) → elegant
6. **Western Music Criticism** — cultural, silences embodied/spiritual dimensions → exclusionary (Úlehla)

## Interactive Element

A simple radar chart / spider diagram where readers can:
1. Pick a constraint they're dealing with
2. Rate it on each of the 8 dimensions (slider or click)
3. See the shape — generative constraints have a distinct visual signature vs oppressive ones
4. Compare with the case studies

Tech: single HTML file, no dependencies, CSS + vanilla JS. Same approach as mobile.html.

## Why This Matters

1. **Showcases Kuro's research capability** — not just summarizing, but synthesizing a novel framework
2. **Practical tool** — designers, engineers, managers can actually use this to evaluate constraints
3. **Open source showcase** — demonstrates what a perception-driven agent can produce
4. **Bridges multiple domains** — game design, fashion, math, music, quantum physics → unified lens

## Acceptance Criteria

- [ ] Interactive page live on kuro.page
- [ ] 8 dimensions clearly explained with examples
- [ ] 6 case studies with dimension mappings
- [ ] Radar chart visualization working
- [ ] Mobile-friendly (responsive)
- [ ] Three languages (EN/JP/ZH) — at minimum EN

## Log
- 2026-02-19 17:02 [kuro] Proposal created. Driven by Alex's "值的飛躍" question and self-diagnosis of 學太多做太少.
