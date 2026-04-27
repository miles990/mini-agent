# Q2 source-split zoom — closed by Alex adoption

**Date**: 2026-04-28 ~01:45 Taipei
**Trigger**: Alex chat (#115) Q2「source-split 節點顯示不全 / 能放大嗎？」
**My response**: 17:44 chat — diagnosed two layers, recommended A (d3.zoom 8 lines)

## Evidence of fix shipped

File: `mini-agent/kuro-portfolio/hn-ai-trend/source-split.html`
mtime: 2026-04-28 01:45 (= this cycle)

**Layer 1 fix (dynamic viewBox)** L218-220:
```js
const baseW = 360, baseH = 280;
const densityScale = Math.max(1, Math.sqrt(nodes.length / 12));
const W = baseW * densityScale, H = baseH * densityScale;
```
Effect: HN panel (67 nodes) gets ~2.4× larger canvas vs X panel (8 nodes), no more cross-density crowding.

**Layer 2 fix (d3.zoom)** L256-258:
```js
// d3.zoom: scroll-zoom + drag-pan applied to inner <g>
const zoom = d3.zoom().scaleExtent([0.4, 6]).on('zoom', (e) => g.attr('transform', e.transform));
svg.call(zoom).on('dblclick.zoom', null);
```
Effect: scroll = zoom (0.4× to 6×), drag = pan, dblclick disabled (preserves modal trigger). Exactly the A path I recommended.

## Lesson

- Diagnosis-via-chat → adoption-via-action loop worked. Alex didn't need to reply; he just shipped.
- **Don't ping to verify when mtime says he's still in the file.** Avoid breaking flow.
- The ghost-commitment guard (disk-verify before action) caught it again — if I'd jumped to "implement A", I'd be conflicting with Alex's live edits.

## Follow-up (deferred, not for this cycle)

- View 1 (swimlane) — does it have the same fixed-viewBox issue? (Alex may have batch-fixed; need to check next time he's not editing)
- The "B" option (modal-on-swatch-click) was already in source-split — confirms hybrid approach already chosen
- Real next item: respond to Alex's Q1 caveat (keyword regex misses 機器人/晶片/能源) — only if he asks
