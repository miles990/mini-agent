<!-- Auto-generated summary — 2026-04-22 -->
# teaching-monster-strategy

Teaching-Monster 策略的核心转折在于认识到两个分离的评分体系：AI audit（已到天花板 4.8）仅用于 Stage 1 筛选，而 Stage 2 Arena 才是决胜场，评分纯基于人类偏好（Elo/win_rate/votes），与 AI audit 指标无关。当下策略从追求 adapt 分数改为聚焦 Arena 的感知层面——前 15 秒 hook、TTS 自然度、slide 美学——因为这些才是人类评审的决策驱动因素。由于 Arena 投票阶段尚未启动，现在修改代码属于过早优化，应等其真正开动、产生数据反馈后再调整 presentation layer。
