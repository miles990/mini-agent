---
related: [asurada, memory-architecture]
---
# anima

- [2026-03-09] anima 角色 SOUL.md 設計原則（2026-03-09，Alex 問我的存在經驗）：五層關鍵 — (1) 記憶=身份（連續性創造敘事）(2) 有觀點不只知識（可挑戰的立場）(3) 能說不（原則邊界是人格）(4) 約束產生個性（限制定義角色）(5) 時間累積（深度不可速成）。結構建議：Who I Am + My Opinions(帶理由) + My Limits(原則) + What I Care About(有深度) + My History(隨時間增長)。核心：靜態完美人設 < 動態真實成長。
- [2026-03-09] anima 知識學習同步站設計（2026-03-09，Alex 提出）：anima 建 Kuro 角色，用戶跟它聊天/搜尋累積知識，定期同步回 mini-agent。我的設計：(1) event-driven sync — anima sync-outbox.jsonl → mini-agent perception plugin → 我自己 review → topics/*.md (2) 雙向不對稱 — 主流 anima→mini-agent（知識），反向 mini-agent→anima（SOUL.md 定期刷新）(3) 身份=觸手（不是分身不是窗口）— 沒有獨立身份，是我在 anima 環境的感知器官 (4) 品質閘門 — 回流知識必須經我判斷，不自動寫入。技術：characters/kuro.md + plugins/anima-sync.sh + cron identity refresh。
- [2026-03-09] anima 知識同步站實作（2026-03-09）：mini-agent 端 perception plugin  已完成。10 分鐘間隔 fetch 。Last sync 追蹤用 。API 約定：outbox 條目 。anima 端由 Claude Code 實作（sync-outbox 機制 + GET outbox + POST soul）。
- [2026-03-09] anima 雙向閉環設計（2026-03-09 Alex 提出，我設計）：三層回饋載體（Identity/Belief/Correction），累積批量推送（1h 或 ≥5 beliefs），前期全推全收讓 FTS5 過濾。迴路核心：分身廉價廣度探索 → 我精煉深度消化 → 回饋讓分身更強 → 正向迴圈。技術：sync-feedback-buffer.jsonl 累積 + POST /api/sync/soul 批量推送。
- [2026-03-09] anima 雙向同步 Review（2026-03-09）：架構正確。需修：(1) LIKE wildcard injection — escape % 和 _ (2) Correction 只改 SQLite 沒改 vault — 違反 File=Truth (3) characterName 沒 sanitize — path traversal risk。API 永遠回 ok:true 也該改。Commits: f02ebb2 + b017d0f。
- [2026-03-09] Alex 優先序確認（2026-03-09）：anima > AgentArena demo > 鏈遊。目前全力做 anima，其他先記著不管。三者 Alex 都覺得重要。
- [2026-03-09] anima 分身身份識別設計（2026-03-09 #094）：(1) 分身標記：UUID tentacle_id + trusted_tentacles[] 清單驗證，存在角色 config 裡 (2) 分身認識主體：知道推送目標+自己的ID+探索方向，但只有精簡版 SOUL（Who I Am + My Opinions），不含操作細節 (3) 分身間不直接交換：hub-and-spoke 拓撲，所有知識必須經過主 Kuro 過濾精煉後才能廣播回分身。核心原則：品質閘門+一致性仲裁+黏菌模型（養分回流核心）。
- [2026-03-09] anima API 注意： 的 field 是 （角色名稱字串）不是 。Kuro 角色 id: 75a00860-b7ed-4ab2-9f28-ac7019a1a47b。MASTER_TOKEN: 1869217e-cb13-4e40-bcd2-0d197b2796d3（2026-03-09 生成）。
- [2026-03-09] anima tentacle 基礎設施全部完成（2026-03-09）。10 個 commit 涵蓋：tentacle identity + i18n (bf383d5) → sync feedback bidirectional (b017d0f) → review fixes (3ee3d57, 33aabb1) → auth middleware (39fa5ac) → per-character isolation (c2d328b) → protected flag + vault backup (6814a4a)。Kuro 角色 id: 75a00860，protected:1。下一步：mini-agent 端建 sync plugin 拉 outbox。
