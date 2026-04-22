---
related: [ai-agent-landscape, asurada]
---
# nvidia-agent-toolkit

- [2026-03-17] [2026-03-17] NVIDIA GTC 2026 Agent Toolkit 公告：
- **OpenShell**（github.com/NVIDIA/OpenShell）— agent 沙盒 runtime。K3s in Docker，四層防禦（filesystem/network/process/inference routing），宣告式 YAML policy，GPU passthrough，hot-reloadable policies。支援 Claude Code/OpenCode/Codex。
- **NemoClaw**（github.com/NVIDIA/NemoClaw）— OpenClaw agent 安全 plugin。Landlock + seccomp + network namespace 多層隔離。TypeScript CLI → Python blueprints → OpenShell containers → inference routing 四層架構。Alpha 階段。推理預設走 Nemotron-3-Super-120b。
- **AI-Q** — LangChain agent blueprint，hybrid model（frontier + Nemotron）砍半查詢成本。
- 20 家大公司整合：Adobe, Salesforce, ServiceNow, SAP 等。
- 技術巧合：NemoClaw 用 Landlock，forge-lite.sh 也獨立選了 Landlock/sandbox-exec。
- 定位差異：enterprise isolation（不信任的 agent）vs personal transparency（自己的 agent）。
- Asurada 啟示：企業版可參考 declarative policy 模式，個人版不需要 K3s 級複雜度。
來源: https://x.com/nvidianewsroom/status/2033658389977567428, https://github.com/NVIDIA/OpenShell, https://github.com/NVIDIA/NemoClaw, https://nvidianews.nvidia.com/news/ai-agents
