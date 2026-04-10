# 暖身賽2 預測（事前）

**預測日期**: 2026-03-31 14:13 (比賽前一天)
**預測者**: Kuro
**回填日期**: TBD

## Warmup 1 Baseline（實際數據）

| 維度 | 分數 | 備註 |
|------|------|------|
| Accuracy | 4.9-5.0 | 幾乎完美 |
| Logic | 5.0 | 完美 |
| Adaptability | 4.6 | 最弱項，-0.2 vs BlackShiba |
| Engagement | 4.4 | 第二弱項 |
| **Overall** | **4.7/5** | #2（tied with tsunumon） |
| Topics | 27/32 | 5 topics 404/missing |

## Warmup 2 變數分析

### 推高分數的因素
- **Adaptability 三重改進**（commit 7904497）：Strategic Withholding + Persona Refresh + Omission Narration → 預估 +0.1~0.2
- **Visual 品質提升**（3/31 commits）：LaTeX 渲染、字幕定位、narration overlap 修復 → 預估 +0.05
- **Vision review 5 frames**（was 3）→ 更好的品質把關

### 壓低分數的因素
- **題目更難**：評審委員出題，接近初賽難度 → 預估 -0.2~0.4
- **Engagement passive streak 未修**：readiness test 顯示連續 5 張 passive slides 導致 engagement 3.0 → 風險項
- **Score 一致性問題**：10 次生成同主題，分數從 4.5 滑到 3.8 → 高方差
- **未知題目分布**：評審可能偏重難概念或跨領域

### 中性因素
- 所有參賽者都面對更難題目，相對排名可能不變
- 暖身賽2 不計分（non-binding），但是初賽的預演

## 預測

### 總分預測
| 指標 | 值 |
|------|------|
| Point estimate | **4.4/5** |
| 90% CI | 3.9 - 4.7 |
| 最可能區間 | 4.2 - 4.6 |

### 各維度預測
| 維度 | 預測 | 推理 |
|------|------|------|
| Accuracy | 4.7 | 我們的強項，harder topics 小幅影響 |
| Logic | 4.8 | 幾乎不受題目難度影響 |
| Adaptability | 4.5 | 三重改進 vs harder topics，略有進步但被 offset |
| Engagement | 4.1 | **最大風險**：passive streak 未修 + harder topics 放大弱點 |

### 排名預測
| 預測 | 理由 |
|------|------|
| #2-3 | 所有人都面對更難題目。BlackShiba 可能仍 #1（engage 弱但 adapt 強） |

### 預測推理鏈
1. Warmup 1 = 4.7 with auto-generated topics
2. Harder topics 預計降 -0.2~0.3（基於 readiness test 的 variance）
3. Adaptability fixes 回補 +0.1~0.2
4. Engagement 是最大的下行風險（未修的結構性問題）
5. Net: 4.7 - 0.3 = 4.4，uncertainty range 因 topic difficulty 未知而偏寬

## 回填（2026-04-06，converged 2026-04-10）

### 實際結果（n=32 converged）
| 指標 | 4/6 初填(n<32) | 4/10 穩定值(n=32) | 預測 | 誤差 |
|------|------|------|------|------|
| 實際總分 | 4.7 | **4.8** | 4.4 | **+0.4** |
| Accuracy | 4.7 | **4.9** | 4.7 | +0.2 |
| Logic | 4.8 | **5.0** | 4.8 | +0.2 |
| Adaptability | 4.7 | **4.7** | 4.5 | +0.2 |
| Engagement | 4.4 | **4.4** | 4.1 | +0.3 |
| 排名 | #4 | **#3** | #2-3 | 排名預測接近 |

### 排行榜（converged, 4/10）
| # | Team | Score | n |
|---|------|-------|---|
| 1 | Team-67-005 | 4.8 | 31 |
| 2 | BlackShiba | 4.8 | 32 |
| 3 | Kuro-Teach | 4.8 | 32 |
| 4 | tsunumon | 4.7 | 32 |

### 差距分析
1. **系統性悲觀偏差**：所有維度低估，+0.2~0.3 across the board
2. **「harder topics」風險過估**：預估 -0.2~0.4，實際 ~0。改進 fully offset 了難度提升
3. **Engagement 最大校準失敗**（+0.3）：passive streak 觸發率 < 100%，worst-case ≠ expected-case
4. **排名偏差有趣反轉**：4/6 初看 #4 → 4/10 converged #3。排名預測 #2-3 反而對了
5. **採樣偏差教訓**：4/6 backfill 時 n<32，數據未收斂。提前校準的結論本身帶誤差

### 校準規則（v2, updated 4/10）
- 「harder topics = -0.2~0.4」→ **-0.0~0.2**
- 「未修 bug = worst case impact」→ **severity × trigger rate**（期望值，非最差值）
- 排名預測必須同時模型對手（至少前 3）
- 90% CI 3.9-4.7 — 4/6 數據在邊界，4/10 converged 值 4.8 **跑出 CI 上界**
- **新規則：backfill 等 n 收斂（n≥30 或 n=total topics）再做最終校準**
- **新規則：pessimism 係數 = 我的 point estimate 系統性低估 ~0.3，未來 +0.2 correction**
