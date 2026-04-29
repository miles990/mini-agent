# Time Filter — Gap Analysis (cycle 129)

**Task**: P2 時間篩選器 — 今天 / 一週 / 一月 / 自訂區間
**Verdict**: 75% shipped (3/4 ranges in 1/3 views) — past-success "80%" was directionally right
**Method**: read-only disk-truth (grep + head, no execution)

## Shipped (verified)

`mini-agent/kuro-portfolio/ai-trend/swimlane.html` L97-105:

```html
<div class="filter-bar">
  <label for="timeRange">Time range: </label>
  <select id="timeRange" onchange="applyTimeFilter()">
    <option value="all">All</option>
    <option value="1">Today</option>           <!-- 今天 ✅ -->
    <option value="7">Past 7 days</option>     <!-- 一週 ✅ -->
    <option value="30">Past 30 days</option>   <!-- 一月 ✅ -->
  </select>
  <span id="filterCount"></span>
</div>
```

Plus `applyTimeFilter()` handler + `filterCount` live readout. UX is decent.

## Gaps (binary list)

| Gap | Spec'd? | Where | Cost |
|---|---|---|---|
| **自訂區間** (custom date range) | ✅ explicit in task | swimlane.html | small — 2× `<input type="date">` + handler tweak |
| graph.html no time filter | implicit (view consistency) | graph.html | medium — different render path, need refactor |
| source-split.html no time filter | implicit | source-split.html | medium — same as above |

## Recommendation

**Close current stack-rank task**. The 1/4 spec'd gap (自訂區間) is small enough to be a single follow-up:

- Follow-up task: "自訂區間 date pickers — swimlane.html only (~30 LOC)"
- Cross-view consistency = separate, larger task — defer until 自訂區間 lands and pattern stabilizes

## Falsifier (this analysis)

If next swimlane.html read shows time filter UI doesn't match L97-105 verbatim → I read the wrong file or stale version. Mtime check: `Apr 28 16:22` (latest file in dir). Confirmed live.

## Past-success reconciliation

Past-success quoted "80% 已 ship (swimlane.html L97-105)". Real number: 3/4 ranges = 75% on the explicit spec, with implicit cross-view = ~50%. Past-success rounded up. Both numbers point to the same conclusion: **don't rebuild, just patch the gap**.
