---
related: [perception, agent-tools]
---
# Web Perception + Browser Automation Open-Source Research

更新時間：2026-03-07（CST）  
研究範圍：`AI browser agent` / `vision web agent` / `web automation LLM`，並交叉參考 awesome list 與 HN/Reddit 討論。

> 你已指定不重複研究 Midscene 與 browser-use。本文件以它們作為比較基準，不重複展開。

## 比較表（候選專案）

| Project | Stars | Language | 最近更新 | 核心方法 | 對 Kuro 的價值（可學/可用） | 與 Midscene / browser-use 差異 |
|---|---:|---|---|---|---|---|
| [Skyvern-AI/skyvern](https://github.com/Skyvern-AI/skyvern) | 20,685 | Python | 2026-03-06 | **Hybrid**（Vision + Playwright） | 可借鏡「Playwright extension + AI prompt actions」與 workflow abstraction；適合導入穩定任務模板。 | 比 Midscene 更偏 web workflow 與 Playwright 生態；比 browser-use 更偏企業流程與 no-code/workflow 層。 |
| [browserbase/stagehand](https://github.com/browserbase/stagehand) | 21,380 | TypeScript | 2026-03-05 | **Hybrid/DOM-first**（CDP + code/LLM bridge） | 可學 `act/extract/agent` 的可控分層與 self-healing/cache 思路，適合 Kuro 做「可重播任務」。 | 不走 Midscene 的 pure-vision 路線；比 browser-use 更偏工程化 framework（強調 deterministic + code control）。 |
| [lavague-ai/LaVague](https://github.com/lavague-ai/LaVague) | 6,311 | Python | 2025-01-21 | **Hybrid**（World Model + Action Engine to Selenium/Playwright） | 可借鏡「world model / action engine」拆層，適合 Kuro 的 perception->action pipeline 設計。 | 比 Midscene 更偏 LAM framework；比 browser-use 更研究導向、可替換 driver。 |
| [steel-dev/steel-browser](https://github.com/steel-dev/steel-browser) | 6,532 | TypeScript | 2026-02-28 | **DOM/Infra**（Browser API + session infra） | 可直接作為 Kuro 的 browser runtime backend（session、資源管理、CDP 接入）。 | 非 perception agent，本質是 infra；和 Midscene/browser-use 的重點不同（可作底座而非大腦）。 |
| [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser) | 12,388 | TypeScript | 2025-11-24 | **Hybrid**（Chrome extension + multi-agent） | 可學本地優先（local-first）與 extension 形態，適合 Kuro 做「使用者本機瀏覽器」路線。 | 比 Midscene 更偏瀏覽器內 extension 產品；比 browser-use 更強調 local/privacy 與多代理協作 UX。 |
| [reworkd/tarsier](https://github.com/reworkd/tarsier) | 1,756 | Jupyter Notebook | 2024-11-25 | **Vision**（OCR + screenshot tagging + text projection） | 可抽出為 Kuro perception plugin：把 screenshot 轉「可推理文字結構 + 元素映射」。 | 更像 perception 元件，不是完整 agent；與 Midscene 同樣重視視覺，但範圍較窄。 |
| [microsoft/OmniParser](https://github.com/microsoft/OmniParser) | 24,454 | Jupyter Notebook | 2025-09-12 | **Vision**（GUI screenshot parsing） | 可用於 Kuro 前處理層：提升 screenshot->action grounding；尤其適合非 DOM 或遠端桌面場景。 | 與 Midscene同屬 pure-vision 思路但偏 parser/tool；比 browser-use 更偏 perception 前端能力而非流程框架。 |
| [PathOnAIOrg/LiteWebAgent](https://github.com/PathOnAIOrg/LiteWebAgent) | 145 | Python | 2025-07-11 | **Hybrid**（VLM-based web agent + Playwright + tree search） | 可借鏡 test-time tree search 與 X-WebArena/Eval 整合，適合 Kuro 強化探索策略。 | 比 Midscene 多了 tree-search/eval 研究框架；比 browser-use 更偏學術可實驗平台。 |
| [EmergenceAI/Agent-E](https://github.com/EmergenceAI/Agent-E) | 1,220 | Python | 2025-06-03 | **Hybrid**（agent orchestration + browser automation + DOM distillation） | 可學 multi-agent orchestration 與 DOM distillation，對 Kuro 的任務分解/協調有參考價值。 | 比 Midscene 更偏多代理編排；比 browser-use 更重 orchestrator 結構與研究論文脈絡。 |
| [MinorJerry/WebVoyager](https://github.com/MinorJerry/WebVoyager) | 1,036 | Python | 2024-03-04 | **Hybrid**（multimodal screenshots + accessibility tree） | 可借鏡 benchmark/資料格式與評測流程；可作 Kuro web-agent regression benchmark。 | 偏 benchmark+研究實作，不是生產框架；與 Midscene/browser-use 相比可用性較低但評測價值高。 |

## 分類總結

  - OmniParser, Tarsier
  - Stagehand, Skyvern, Steel Browser, Nanobrowser, LaVague
  - LiteWebAgent, Agent-E, WebVoyager（研究導向）

## 社群討論（HN / Reddit）

### HN（可直接驗證）
- [Launch HN: Browser Use (YC W25) – open-source web agents](https://news.ycombinator.com/item?id=43196071)
- [Show HN: Skyvern – Browser automation using LLMs and computer vision](https://news.ycombinator.com/item?id=39699198)
- [Launch HN: Skyvern (YC S23) – open-source AI agent for browser automations](https://news.ycombinator.com/item?id=41950599)
- [Show HN: Skyvern 2.0 – open-source AI Browser Agent scoring 85.8% on WebVoyager](https://news.ycombinator.com/item?id=42718974)
- [Ask HN: Browser Use, Skyvern or Other for Automating Directory Submission](https://news.ycombinator.com/item?id=42693057)

### Reddit（本次限制）

## 對 Kuro 的實作建議（精簡）

1. 先走 **Hybrid 主線**：`Stagehand/Skyvern` 的可控執行層 + `OmniParser/Tarsier` perception 插件化。  
2. 評測層直接接 `WebVoyager` 任務格式，建立 Kuro 自己的 regression set。  
3. 若要本機透明與使用者信任，優先評估 `Nanobrowser` 式 extension interaction model。  
4. 若要快速上雲/多 session，`Steel Browser` 可做 runtime 基礎設施而不是 agent 本體。

## Sources

- https://github.com/nanobrowser/nanobrowser
- https://hn.algolia.com/

### 現有工具
1. cdp-watch.mjs + cdp-events.sh — push-based tab lifecycle（新）
2. chrome-tabs.sh — 120s poll（可逐步被 cdp-events 取代）
3. web-fetch.sh — 5-layer adaptive cascade（curl→jina→stealth→grok→cdp）+ quality gate + domain routing
4. cdp-fetch.mjs — on-demand fetch/screenshot/interact/inspect
5. search-web.sh + SearXNG — 多引擎搜尋
6. website-monitor.sh — 只監控 kuro.page
7. environment-sense.sh — 30min network snapshot（太粗）
8. stealth-fetch.py — anti-bot（依賴 uv）

### 明確缺口

### 複利改善方向
(1) 視覺判斷 — screenshot→VLM，判斷頁面類型/價值（~1K tokens/張，便宜）
(2) 內容提取 — Crawl4AI  > Trafilatura > Readability。AI-first 輸出直接對接 LLM，取代現有 sed 粗暴清洗
(3) 視覺互動 — CDP self-healing 現行方案夠用，未來可考慮 midscene 純視覺路線
關鍵判斷：midscene 放棄 DOM 對互動正確，但內容提取需要結構化處理（VLM 讀長文太貴）。不能用一個方案統吃。最高 ROI 改動：升級 Layer 2（替換 web-fetch.sh 的 sed）。
