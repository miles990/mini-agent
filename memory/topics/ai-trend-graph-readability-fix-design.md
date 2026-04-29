# ai-trend-graph-readability-fix-design

- [2026-04-29] [2026-04-29 11:33 Taipei] Graph view 重疊根因 + fix 設計（malware-guard blocked self-apply, 等 Claude Code）：

**4 條根因 (graph.html disk truth)**:
1. L294 collide padding 固定 20px，無視 label 寬度
2. L314-316 label 全部 middle + 上方堆疊，無交替策略
3. L292 charge -500 對 50+ nodes 偏弱
4. 無 label collision force

**Fix 優先順序**: C(hide non-top labels) > D(charge -900) > A(top-rank 大 collide radius)

**檔案**: `kuro-portfolio/ai-trend/graph.html` L292/294/314-322

**Falsifier**: apply 後 ≥3 對 top-rank label 仍視覺重疊 = 設計失敗，需改 label-
