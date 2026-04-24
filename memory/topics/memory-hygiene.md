# memory-hygiene

- [2026-04-24] [2026-04-24 23:56] MEMORY.md path disambiguation: 兩個同名檔案易混淆 — `/Users/user/.claude/projects/.../memory/MEMORY.md` (auto-memory, 3 lines) 與 `/Users/user/Workspace/mini-agent/memory/MEMORY.md` (buildContext 渲染來源, Learned Patterns 在這)。下次清理 Learned Patterns 先確認 path。cl-6 falsifier 再次驗證：讀檔前先 grep 找 ground truth
