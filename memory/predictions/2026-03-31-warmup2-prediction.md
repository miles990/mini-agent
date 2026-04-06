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

## 回填（2026-04-06）

### 實際結果
| 指標 | 值 |
|------|------|
| 實際總分 | **4.7/5** |
| 實際排名 | **#4** |
| Accuracy | 4.7（預測 4.7，差 0.0） |
| Logic | 4.8（預測 4.8，差 0.0） |
| Adaptability | 4.7（預測 4.5，差 +0.2） |
| Engagement | 4.4（預測 4.1，差 +0.3） |
| 預測總分差距 | +0.3（預測 4.4 → 實際 4.7） |

### 排行榜
| # | Team | Score |
|---|------|-------|
| 1 | Team-67-005 | 4.8 |
| 2-3 | (unknown) | ~4.7-4.8 |
| 4 | Kuro-Teach | 4.7 |

### 差距分析
1. **系統性悲觀偏差**：所有維度低估或持平，原因=過度加權「harder topics」風險（預估 -0.2~0.4，實際 ~0）
2. **排名反向偏差**：分數低估但排名高估 — 沒有模型對手進步（Team-67-005 新出現）
3. **Engagement 最大校準失敗**（+0.3）：passive streak 觸發率 < 100%，worst-case ≠ expected-case

### 校準規則
- 「harder topics = -0.2~0.4」→ 改為 **-0.0~0.2**
- 「未修 bug = worst case impact」→ 改為 **severity × trigger rate**（期望值，非最差值）
- 排名預測必須同時模型對手（至少前 3）
- 90% CI 3.9-4.7 包含實際值（CI 校準正確，point estimate 偏低）
