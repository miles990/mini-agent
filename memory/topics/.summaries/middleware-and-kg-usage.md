<!-- Auto-generated summary — 2026-04-19 -->
# middleware-and-kg-usage

本文確立中台（middleware）和知識圖譜為預設 pipeline 的三層運作架構：推理層先查已有知識、規劃層用 DAG 拆解複雜任務、執行層透過 middleware 路由工作，避免 foreground 硬扛長推理。通過明確分工（記憶/主題/KG/執行工具），防止知識碎片化和工作流瓶頸。核心反面教訓：新知識應同時回寫結構化知識圖，跨度 >1 cycle 的工作應直接 delegate，不在主迴圈中串聯深度工作。
