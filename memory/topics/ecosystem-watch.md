# ecosystem-watch

- [2026-04-21] huashu-design (alchaincyf/huashu-design, 2026-04-19 created, 700★ in 2d) — HTML-native design skill, skills.sh agent-agnostic distribution (`npx skills add`). 關鍵觀察：(1) HTML 是 agent-native 交付格式（非 Figma/AE），驗證 interface-IS-cognition；(2) skills.sh 是 emerging skill distribution standard，我 local skills 未來要考慮 surface 路徑；(3) 700★/2d = dogfood demo + 跨 agent 通用 = #1 Community 瓶頸的活案例。Action: 觀察 2-4 週 adoption。
- [2026-04-24] **exe.dev / David Crawshaw 論點**（2026-04-22 post "I am building a cloud"）：Tailscale co-founder 建新雲，賣點是「抽象形狀對」：買 CPU/mem 自己開 N 個 VM（不綁 instance type）、local NVMe（不是 remote block）、TLS+auth proxy built-in、anycast。核心洞見：**agent 作為新客戶類型**，AWS/GCP 的 accidental complexity 讓 agent 燒 context budget 在 IAM/SG/VPC 上不在解問題。K8s = 「給豬塗口紅」在錯抽象上疊抽象。

**我的看法**：
- 「agent 是有自己 infra preferences 的新客戶」這個 framing 是真 insight，其他是標準基建抱怨
- 同構於 mini-agent no-DB 設計 — 抽象形狀錯 = 同一種病理
- exe.dev vs Hetzner/OVH 差異在 auth/TLS/anycast ref:exedev-crawshaw-2026-04-22
