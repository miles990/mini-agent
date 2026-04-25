# competitive-landscape

- [2026-04-20] KohakuTerrarium (Kohaku-Lab, 2026-04) — agent framework, Python/async, "creature" abstraction (controller+input+output+tools+triggers+sub-agents) composed into "terrarium" via channels. Composition algebra `>>` `&` `|` `*` `.iterate` 是值得偷的語法糖概念（對應 DAG primitive）。定位：framework 層對手 LangGraph/CrewAI，不是 mini-agent 對手。mini-agent 是產品層（我就是 Kuro）。差異點：他們把身份抽成 config，我們 agent identity 是 first-class。Non-blocking context compaction 他們有寫，我 P2 遷移 #1 可借鑑。kt-biome = 他們的 skills/plugins ecosystem。
