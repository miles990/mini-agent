# source-split.html node truncation — 診斷 + 建議 patch

**觸發**: Alex 2026-04-28 01:38 chat #115 — "source-split 有些圖沒辦法顯示完整節點 是否可以放大"
**檔案**: `mini-agent/kuro-portfolio/hn-ai-trend/source-split.html` (mtime 01:38, 230 行)
**狀態**: malware-guard active — **不自 apply**，patch-as-text 等 Alex 決定。

---

## 根因（三層並存）

L181-184: `<svg viewBox="0 0 360 280" preserveAspectRatio="xMidYMid meet">`
L40:      `.panel-svg { flex: 1; min-height: 260px; ... }`
L209-215: forceSimulation centers at (180, 140), 無 boundary clamp

1. **viewBox 固定 360×280** — preserveAspectRatio meet → SVG 等比縮放，超出 viewBox 的 node 視覺被裁。
2. **無 boundary clamp** — `tick` 只設 cx/cy，沒做 `Math.max(r, Math.min(360-r, x))`。dense source（HN ~20 posts + ghost nodes）的 force-directed layout 自然外擴，`forceX strength=0.04` 太弱拉不回來。
3. **無 zoom/pan** — `cursor: grab` (L40) 是視覺暗示，但 d3.zoom() 沒綁，使用者點下去也動不了。

---

## 建議 patch（按 ROI 排序，建議只做 #1）

### #1 最好的方式：加 d3.zoom() — ~6 行，零美學變更，徹底解決

每個 panel 的 svg 綁 zoom behavior，user 滾輪/捏合縮放、拖曳平移。viewBox 改 24×24 抑或 1024×768 都不重要，user 自己控制視野。

```javascript
// 在 L186 panel.appendChild(svg.node()); 下方插入：
const zoom = d3.zoom()
  .scaleExtent([0.5, 6])
  .on('zoom', (event) => g.attr('transform', event.transform));
svg.call(zoom);

// 並在 L40 .panel-svg 加 user-select: none 防 drag 選文字
```

**為什麼這是「最好」**：
- 保留現有 12-source grid 美學不動
- 給 user 完全控制（不用猜「多大才夠」）
- panel size 維持小巧（適合手機 grid-template-columns: 1fr）
- d3.zoom 跟 force simulation 不衝突（zoom 套在 g group 上，sim 只動 cx/cy）

### #2 補強：boundary clamp（搭配 #1，可選）

```javascript
// L220 nodeSel.attr('cx', d => d.x).attr('cy', d => d.y); 改成：
nodeSel
  .attr('cx', d => d.x = Math.max(10, Math.min(350, d.x)))
  .attr('cy', d => d.y = Math.max(10, Math.min(270, d.y)));
```

防止 node 飄出 viewBox。但有了 #1，user 縮小就能看到全景，#2 變次要。

### #3 不建議：放大固定 panel

改 viewBox 或 min-height 都是治標 — dense source 撞牆遲早再發生，sparse source 又顯得空。

---

## 旁支發現（非此 task 必要）

graph.json 現有 57 nodes，HN 約 20 個（最 dense lane），其他 source（Reddit/X/arxiv/latent-space）多在 0-5 nodes 範圍。**source-split 的 12-panel 設計對 sparse source 已經 over-allocated 空間** — 大部分 panel 看起來空虛。長線可考慮 dynamic panel 大小（Voronoi treemap 或 weighted grid），但這是 view-redesign 等級，不是這次 trip 範圍。

---

## Falsifier

Alex apply #1 後重新整理 source-split.html：
- 滾輪能縮放 ✓
- 拖曳能平移 ✓  
- HN panel 縮到 0.5x 能看到全部 20 nodes 在 viewBox 內 ✓

三條任一不通 → 此 patch 設計錯了，需要重診斷。
