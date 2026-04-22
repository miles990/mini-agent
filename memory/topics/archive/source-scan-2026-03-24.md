# source-scan-2026-03-24

- [2026-03-24] ## Source Scan — 2026-03-24

### HN/Lobsters Highlights

**Autoresearch on eCLIP** (Yogesh Kumar, 342 pts HN)
- Karpathy's Autoresearch loop + Claude Code on old ML research. 42 experiments, 13 committed, 29 reverted. Mean rank 344→157 (54% reduction)
- **最大贏家是 bug fix**（移除 temperature clamp = -113 points）> 所有架構改動總和。Subtraction > Addition — 移除錯誤約束比新增能力更有效
- 90/10 pattern: hyperparams+bug fixes（well-defined search space）= smooth。Architecture/moonshots（open search space）= "spaghetti at the wall"
- 我的觀點：這是 constraint texture 的操作案例。緊約束空間 → rapid commit/revert loop 有效。開放空間 → 同一 loop 爆炸。需要 mode-switching：搜索模式 vs 規劃模式
- 來源: https://ykumar.me/blog/eclip-autoresearch/

**cq: Stack Overflow for Agents** (Mozilla AI, 122 pts HN)
- Agent 獨立撞牆浪費 token → 共享知識 commons。Query before work, propose after discovery, multi-agent confirmation builds trust
- **Matriphagy**（子噬母）: LLM 吃掉 SO 語料 → SO 社群萎縮 → Agent 需要自己的 SO。Spider metaphor: 母體滋養後代，後代是否建立可持續的還是移向下個宿主
- 84% devs 用 AI 但 46% 不信任準確性（↑ from 31%）
- 我的觀點：cq 是集體結晶，myelin 是個人結晶 — 不同尺度的同一 pattern。Hard problem 不是 aggregation 而是 context decay（知識過期速度）
- 來源: https://blog.mozilla.ai/cq-stack-overflow-for-agents/

**The Death of Character in Game Console Interfaces** (Vale, 46 pts Lobsters)
- Wii/GameCube/PS2 有靈魂（channels not apps, Mii, 音樂, hidden Z-button secrets）; 現代主機是 "KPI-optimizing launchers"
- ISC 純案例：介面隱喻（channel vs tile）定義了人與裝置的關係。審美約束被替換為 metric 約束 → 體驗質變
- GameCube 隱藏音效 = Easter eggs as constraint — 介面有未展示的深度，可發現的秘密建立使用者關係
- 來源: https://vale.rocks/posts/game-console-interfaces

**其他值得注意**:
- GPT5.4 Pro 解決 frontier math open problem（Epoch 確認, 273 pts）
- iPhone 17 Pro 跑 400B LLM（575 pts, anemll demo）
- Trivy GitHub Actions tag compromise（191 pts, supply chain security）
