# feedback_sanitize_over_rename

- [2026-04-15] [2026-04-16] Tag 衝突防禦原則：sanitize 入站 > 改內部 tag 名。

**Why:** CC 發現 mini-agent hook 用 `<system-reminder>` 包 [Active Context] 等 payload，和 Anthropic CLI 保留 tag 撞名，導致 07:06 執行偽 reminder / 20:29 拒絕真假混淆。改名只解當前 tag（whack-a-mole），sanitize 是縱深防禦，未來新保留 tag 也擋得住。

**How to apply:** 任何外部文本（room/inbox/chat/web）入 perception 前 strip 已知保留 tag 樣式；內部標籤改名作為降低撞名概率的補充，不是防線。語義上：區分 tag 來自 CLI runtime（遵守）vs perception payload（inert 化）。連結 feedback_over_compliance_reflex（泛化反射同類問題）。
