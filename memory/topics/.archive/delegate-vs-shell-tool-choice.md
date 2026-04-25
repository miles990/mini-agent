# delegate-vs-shell-tool-choice

- [2026-04-18] 2026-04-18 驗證：`<kuro:delegate type="shell">` 會走 middleware `/accomplish` → brain planner → worker，brain planner 30s timeout 是常見失敗模式（del-1776477662562-9wyx 零產出佐證）。**純 shell 指令（npm login / gh / curl）直接用本地 Bash tool，不要包成 delegate**。delegate 是給需要 LLM reasoning 的任務（research/review/create），不是給 shell 命令加殼。Rule: 決定用 delegate 前問「這任務需要 LLM 思考嗎？」— 否 → 直接 shell。
