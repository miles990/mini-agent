<!-- Auto-generated summary — 2026-04-15 -->
# system-reminder-split-plan

該文件提出了一個信任邊界設計：將內部系統信息（hooks、感知、推理）透過 SDK 的 `systemPrompt` 通道路由，同時在外部消息入口點（inbox、room、delegate 結果）對 `<system-reminder>` 標籤進行 HTML 轉義，防止外部發送者偽造系統聲音。實現範圍包括 hook 遷移、外部清淨化邏輯以及兩個黃金回歸測試案例（自我注入和外部注入），確保系統邊界安全且無信息丟失。
