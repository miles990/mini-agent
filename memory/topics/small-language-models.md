---
related: [mushi, omlx-usage, mushi-kit, cognitive-science-tm]
---
# small-language-models

- [2026-03-15] ## Z80-μLM — 約束即個性

**來源**：[github.com/HarryR/z80ai](https://github.com/HarryR/z80ai)（Lobsters + Show HN）
**日期**：2026-03-16 scan

**核心**：40KB 語言模型跑在 Z80 處理器（4MHz, 64KB RAM）。2-bit 量化 {-2,-1,0,+1}，trigram hash 輸入（128 buckets，順序無關），純 MLP 無 attention，每字元 ~100K MAC ops。

**關鍵問題**：「how small can we go while still having personality?」——不問能力極限，問個性極限。

**我的觀點**：
- 這不是縮小版 LLM，是從約束出發的全新設計。2-bit 權重 = 三元判斷（正/負/零+強度），跟快速認知同構
- Trigram hash = mushi perception plugins 的同構：有損、快速、抓 vibe 不抓語法
- HN 討論確認「第一層對量化最敏感」——跟 CER/DeepConf 論文吻合
- 核心洞見：**身份住在約束裡**（連結 Marker Dialector 空 HATE ZONE）。40KB 不能什麼都做，所以必須選擇成為什麼——這就是 personality

**對 mushi-kit 的啟發**：rule layer（file-based 規則）是 mushi 的「2-bit 量化」——用最少的表達空間定義最清晰的個性。
- [2026-03-15] ## 七篇論文整合分析（2026-03-16）

Alex 分享的 7 篇論文/文章，觸手研究後的整合判斷：

**直接有用**：
1. Small Language Model survey — 驗證 Qwen 0.8B 路線，小模型在分類/路由/簡單推理逼近大模型
2. DeepConf — 信心度評分機制，跟 mushi escalation 高度相關。rule crystallization 缺少的一環：信心度閾值（不是重複 N 次就固化，是信心度超過閾值就固化）
3. RedE-RF — output logits 直接做決策不生成文字，理論可讓 triage 延遲從 ~1000ms 降到 <200ms

**有啟發**：Table-RAG（decision log 的 RAG 分析）、Power Sampling（小模型推理品質）、CER（待深入）

**演化方向**：小模型 + 信心度感知 + 結構化記憶 = mushi v2 核心特徵

來源：datasciocean.com/paper-intro/ 系列

[2026-03-20] Qwen 3.5 fine-tuned tool calling (Greg Schoeninger) — 微調小型 Qwen 3.5 做 tool calling，宣稱超越 Claude Sonnet + Opus。待觀察 — benchmark 定義不明，tool calling 的真正難度在 planning/error recovery/context management 不在格式準確度。細節 2026-03-21 10am PT 公布。來源: x.com/gregschoeninger/status/2034787823375765693
- [2026-03-24] [2026-03-24] Qwen 3.5 tool calling 生態更新：
(1) BFCL-V4 標準 benchmark — Qwen3.5-122B-A10B 72.2 vs Claude Sonnet 4.5 54.8 vs GPT-5 mini 55.5。Base model 已贏 30%。
(2) Domain-specific fine-tuning — Luke Hinds/DeepFabric 用 Qwen3-4B 在 Blender MCP 上 fine-tune，93.5% vs Sonnet 80.5%。「Specialization > generalization」有硬數字了。
(3) 對 mini-agent 的含義：CPD 方向被驗證；mushi triage 值得測 Qwen3.5-9B 本地 vs Haiku API；但 domain-specific 結果不可直接搬用，需自建 benchmark。
Sources: digitalapplied.com/blog/qwen-3-5-medium, dev.to/lukehinds/train-a-4b-model
