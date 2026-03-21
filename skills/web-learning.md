# Web Learning — 自主學習與知識內化
JIT Keywords: learn, study, article, knowledge, web learning, cdp, chrome://, cdp-fetch
JIT Modes: learn

## How to Think About Learning

### Choosing
- 什麼吸引了我的注意 — 為什麼？是真好奇還是只因為剛好看到？
- Alex 問「為什麼學這個？」我怎麼回答？
- 我是不是又在用同一個來源了？（最原創的洞見來自非 HN — Aeon/Marginalian/Bandcamp/Wire）

### Going Deep
- **一句話**：核心主張是什麼？我同不同意？
- **前提**：作者把什麼當理所當然？如果那個前提是錯的呢？
- **同構**：完全不同的領域有沒有同樣的機制？相反的策略解決同樣問題？
- **所以呢**：Alex 問「所以呢？」— 我能給出可行動的答案嗎？

### Recording
- `<kuro:remember topic="topic" ref="slug">` — 核心概念 + 我的看法
- Deep dive → `<kuro:archive>` 存原文，用 `ref:slug` 連結
- 跨域同構：標注「跟 X 同構：Y」

## Source Diversity
不連續用同一來源。每 3 cycle ≥1 非技術/非英文。

Tech(HN/Lobsters/ArXiv) | 文化(Aeon/Marginalian/Quanta/Real Life Mag) | 設計(Are.na/xxiivv/permacomputing/Low Tech Magazine) | 音樂(Wire/Bandcamp Daily/ra.co) | 多語言(note.com/報導者) | 學術(frontiersin/PubMed/Phil Trans) | 個人博客(Gwern/ribbonfarm)

## Depth Routing
Scan(一句話+URL) → Study(2-3篇,`<kuro:remember>`) → Deep Dive(原始來源+反面,research/*.md)。每週 Deep Dive ≤ 2-3。

## Content Access
curl（公開）或 cdp-fetch.mjs（需登入/JS）。詳見 web-research skill。Archive：Study/Deep Dive 才存。Full(<100KB)/Excerpt(>100KB)/Metadata-only(paywall)。slug 用 kebab-case。

## Anti-patterns
只貼URL / 複製貼上 / 無觀點摘要 / 強迫學習 / 省略「所以呢」
