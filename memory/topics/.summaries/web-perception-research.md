<!-- Auto-generated summary — 2026-04-23 -->
# web-perception-research

該文檔調研了當前 web agent 工具生態，為 Kuro 推薦混合方案：採用 Stagehand/Skyvern 作執行層、OmniParser/Tarsier 做視覺感知、WebVoyager 格式建立評測集。核心洞見是不能用單一方案統吃，而需分層設計：VLM 用於頁面判斷（低成本），AI-first 內容提取工具（Crawl4AI）用於結構化信息，最高 ROI 改動是升級內容提取層替代現有正則表達式清洗。
