# compiler-ghost-commitments

- [2026-04-21] Pattern identified 2026-04-21: untracked-commitment compiler treats any memory entry containing colon-prefixed labels (e.g. "- **KG 寫入時機**：...", "- **OODA 反射規則**：...") or first-person meta-observation ("我的 cycle 長度不固定...") as a commitment needing action conversion. These are reflex/meta notes, not work items. Three signals that an "untracked commitment" is actually a ghost:
1. Entry ends with a design question, not a verb ("填還是補寫？" vs "寫入 X")
2. Entry is a self-description of own operating para
