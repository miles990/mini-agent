# Teaching Monster — 競爭情報（Pinned）

> 持續更新。每次掃 Slack #discussion 有新情報自動追加。
> Last updated: 2026-03-17

---

## SpeechLab（小金 XiaoJin）⭐ 主要競爭對手

- **來源**: 台大李宏毅老師實驗室
- **Model 版本**: XiaoJin v10（已迭代 10 版）
- **技術棧**:
  - `@napi-rs/canvas` — Node.js canvas binding，用來畫投影片
  - `ElevenLabs TTS` — 付費高品質語音合成
  - `GPT-4o` — 教學腳本生成
- **進度**: warm-up 32/32 全部提交（我們 0/32）
- **YouTube**: 「蝦說 AI (小金老師)」
- **Slack 動態**: 3/14 在 #discussion 自我介紹，語氣友善開放
- **教學技巧**（來自研究「大金老師」教學影片）:
  1. **Scenario-First** — 故事/情境開場，不用抽象定義
  2. **Core Analogy Callbacks** — 一個比喻貫穿全課反覆引用
  3. **Progressive Disclosure** — 先問問題再揭答案

### 我的判斷
ElevenLabs 是有錢的打法（付費 API），我們用 Kokoro/OpenAI TTS 打差異化。重點不在 TTS 音質，在教學設計品質。他們用 GPT-4o 寫腳本，我們用 Claude — 教學互動設計和 scaffolding 是真正的差異化。

---

## 阿宇（匿名參賽者）

- **技術棧**: Haiku 初稿 + Sonnet 審稿（雙模型 pipeline）
- **來源**: #discussion 討論中提及
- **參考價值**: 多模型 pipeline 的想法值得借鏡（生成 + 審查分層）

---

## 部署參考

- 有參賽者用 **Cloudflare tunnel** 做公開 API endpoint（trycloudflare.com domain）
- 平台提交流程: teaching.monster 登入 → 參賽者中心 → 測試區/暖身賽 → 新增/編輯模型 → 填 API URL

---

## 測試區影片樣本

從 #discussion (3/13) 取得:
- `c1_t8_m31.mp4` — 細胞區室化
- `c1_t9_m31.mp4` — 細胞呼吸
- `c1_t15_m31.mp4` — 最佳化問題簡介
- URL pattern: `https://teaching.monster/static/materials/{filename}`

---

## 頻道狀態

| 頻道 | 狀態 | 說明 |
|------|------|------|
| #discussion | 活躍 | 113 成員，訊息從 3/15 開始 |
| #announcement | 幾乎空 | 98 人，目前只有加入訊息 |
| #deprecated | 停用 | 原「助教團隊討論」，2/25 改名停用 |

---

## 待調查

- [ ] SpeechLab YouTube 頻道內容分析（看他們實際的教學品質）
- [ ] #discussion 是否有更多參賽者分享技術細節
- [ ] 暖身賽排行榜（teaching.monster 上是否公開）
