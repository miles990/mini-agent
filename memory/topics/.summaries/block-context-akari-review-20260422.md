<!-- Auto-generated summary — 2026-04-22 -->
# block-context-akari-review-20260422

Akari 承諾在 Step F 進行審查，驗證三項關鍵條件：T1 sections 不被 trim、focused mode 控制在 25K 以內、無資訊遺失。在準備實作時發現 PROTECTED_SECTIONS 與 SECTION_TIERS 存在語義發散，9 個 section 跨集合但 6 個 section 只在其中一套常數中，建議統一為單一真實來源（SECTION_TIERS）以避免 optimizer 意外降級關鍵上下文。
