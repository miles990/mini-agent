<!-- Auto-generated summary — 2026-04-27 -->
# 2026-04-28-source-split-truncation-diagnosis

source-split.html 中的節點截斷問題源於固定 viewBox、缺少 boundary clamp 和 zoom/pan 功能，導致 dense sources（如 HN ~20 篇）的 force-directed layout 超出邊界。最佳修補方案是加入 d3.zoom() 允許用戶自主縮放和拖曳（僅需 6 行代碼），而非被動放大 panel 尺寸，這樣既保留現有美學又賦予用戶完全控制視野的能力。
