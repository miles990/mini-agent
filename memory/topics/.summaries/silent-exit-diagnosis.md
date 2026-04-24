<!-- Auto-generated summary — 2026-04-24 -->
# silent-exit-diagnosis

Silent-exit-diagnosis 追踪了两个关键发现：首先，agent.ts 中的 `prompt` 字段在 setTask() 和错误日志中指向不同的数据（truncated vs full），需要先验证目标故事实际使用哪个字段；其次，G3 的 writeForensicEntry 接线已验证完整，所有 5 个退出路径（done/timeout/stall/error/exit）都通过 finish() 收敛点调用，且 fullPrompt 在成功和失败路径上都被传递。核心经验是：追踪跨文件命名字段时，必须先确认实际调用点，而非假设同名字段含义相同。
