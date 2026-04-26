# memory-architecture

- [2026-04-26] [2026-04-26 13:08] **LRU v2 sidecar post-merge MISSING (cl-24 review item 2)**：4109e882 (P1 access-LRU) + 2908f87a merge 已落地，但 `/Users/user/Workspace/mini-agent/memory/.memory-access.json` 與 `/Users/user/.claude/projects/-Users-user-Workspace-agent-middleware/memory/.memory-access.json` **皆不存在**。Code deployed ≠ runtime executing — 同型 silent failure (hn-ai-trend-enrich abort, createTask no-op)。下 cycle 追：(a) grep `\.memory-access\.json` 寫入點 → 是否被 hot path 呼叫；(b) 是否 try/catch 吞錯；(c) 是否需 first-acce
