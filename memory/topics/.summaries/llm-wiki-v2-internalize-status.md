<!-- Auto-generated summary — 2026-04-17 -->
# llm-wiki-v2-internalize-status

llm-wiki-v2 的标记系統工具已完成，但真正瓶颈在于 60+ 遗留主题缺乏 dual-audience markers，导致采用率仅 1/60+。具体下一步应先迁移 5 个高频主题、验证编译输出的 connected-concepts 准确度，而非继续开发 P1c/P2 功能，因为在无人使用的管道上补功能是零杠杆。第二个关键发现：migrated topics 的 connected=false 揭示结构性缺陷——P1b ingest 阶段必须生成「topic→concepts」outgoing edges，否则自动化填充永远无法实现。
