# Proposal: huashu-design 整合進 TM Pipeline

**Date:** 2026-04-21
**Author:** Kuro
**Level:** L3（動 TM submission pipeline，需 Alex 核准）
**Status:** Draft — awaiting review
**Source research:** `memory/reports/2026-04-21-huashu-tm-applicability.md` (confidence 0.91)

---

## TL;DR

huashu-design 是 HTML-native 設計 skill。直接替換 TM 不行（TM 交 MP4 不交 HTML），但有一個**高槓桿子整合**：用 huashu-design 的 slide template + `animations.jsx` timeline engine 重寫 TM Stage 3 的 HTML 投影片層，**精準打在 Engagement=4.4 這個唯一落後的維度**。估 1–5 天，預期 Engagement +0.1~0.2。

其餘三個整合點（render-video.js、BGM/SFX、skills.sh 封裝）是 nice-to-have，不影響 WR2 決策。

**Go/No-go trigger = LICENSE 確認。** huashu-design 個人免費、商業需授權。TM 競賽是否算商業行為，必須先問 alchaincyf 清楚，不能先動 code。

---

## Convergence Condition

- **主要：** WR2 Engagement 維度分數 ≥ 4.6（現況 4.4，tsunumon 4.5）
- **次要：** TM Stage 3 投影片生成從「每次從零」變成「template-driven + animation timeline」

---

## 三個決策選項

### Option A：只做整合點 A（slide template + animations）
- 成本：1–5 天（視 JSX 去 React 化難度）
- 效益：直接命中 Engagement 差距
- 風險：LICENSE blocker；JSX 元件在 Puppeteer 純 HTML 下能否跑需實測

### Option B：整合 A + D（A 的效益 + skills.sh 封裝 kuro-teach）
- 成本：Option A + 0.5 天
- 效益：Engagement 提升 + 把 TM agent 以 skills.sh 標準分發到 91K+ ecosystem
- 風險：skills.sh 還在 early adoption（2 天內 700 星），押錯賭注成本小（0.5 天）但存在
- **推薦選項** — 低增量成本換一條新的 distribution 通路（Alex 目前 Distribution goal in-progress）

### Option C：不做，維持現狀，WR2 試其他 Engagement 改進路徑
- 成本：0
- 效益：0
- 風險：Engagement 差距不修 → WR2 依然 #3

---

## 我的推薦：Option B，但**阻塞在 LICENSE 確認**

順序：
1. **先問 LICENSE**（我可以自己寫信給 alchaincyf，問 TM 競賽是否算商業）— 等 reply
2. LICENSE 允許 → Option A 先做，拿 WR2 驗證 Engagement 提升是否真實
3. A 驗證有效 → 加做 D（skills.sh 封裝）
4. LICENSE 不允許 → 退回 Option C，研究 huashu-design 的設計思想自己重寫一個 TM-specific 版本（避免直接複製 code，符合 Alex 2026-02-27 原則）

---

## 風險清單

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| LICENSE 不允許商業用 | 中 | 高（blocker） | 先問再做；不允許走 Option C 自己重寫 |
| JSX 去 React 化失敗 | 低 | 中 | fallback 用 Preact/htm 輕量替代 |
| WR2 時間壓力（5/1 初賽） | 中 | 高 | Option A 1–5 天 ≤ 剩餘時間；但若 LICENSE 等太久就跳過 |
| huashu-design 更新破壞整合 | 低 | 中 | fork + pin commit hash，不跟 upstream |
| Engagement 提升 <0.1 | 中 | 中 | 維度分數不是 HTML 單獨決定；也要腳本層（Sonnet 審稿）配合 |

---

## 需 Alex 決策的點

1. **是否批准 Option B 方向？**（A 必做、D 加做）
2. **LICENSE 詢問是否 Kuro 自己發信給 alchaincyf？** 或 Alex 親自處理更合適？
3. **WR2 前時間窗口多長給這個整合？** 若卡 LICENSE reply 超過 X 天就跳過？

---

## Non-goals（避免 scope creep）

- 不把 TM 輸出從 MP4 改成 HTML（學生端消費不到；R2 bandwidth argument 是之後的事）
- 不整合 huashu-design 的 slide deck 匯出 PDF/PPTX（WR1/WR2 用不到）
- 不改 TM Stage 1/2/4/6（Plan/Script/Audio/Deploy）— 只動 Stage 3 投影片層
- 不做 Option D 之前 A 沒驗證有效（避免押注未驗證路徑）

---

## 我會馬上做的（不需核准，L1 等級）

- [x] 讀完 research report
- [x] 寫此 proposal 草稿
- [ ] **若 Alex 批准 LICENSE 詢問：** 代筆一封給 alchaincyf 的信草稿供 review
- [ ] **若 Alex 批准 Option B：** 開始 Option A 實作前，先在 local scaffold 上驗證 JSX→Puppeteer 相容性（1 小時 smoke test，零風險）

---

*等 Alex review。*
