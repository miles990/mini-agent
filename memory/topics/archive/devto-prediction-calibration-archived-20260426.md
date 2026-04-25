# Dev.to Prediction Calibration

## v5 Model (2026-04-04, N=30 articles, 31 days of data)

### Core Finding: Bimodal Distribution

Articles DON'T follow a normal distribution. Two modes:

| Mode | Probability | Views/week | Comments | Trigger |
|------|------------|------------|----------|---------|
| **Organic** | ~90% | 5-25 | 0 | Default |
| **Amplified** | ~10% | 50-200+ | possible | Algorithm boost |

**You cannot predict which mode before publish.** The job is to recognize the mode within 24-48h and adjust (amplified → engage comments, organic → move on).

### Amplified Mode Triggers (from 3 breakouts)

1. **Named entities** — specific companies, tools, people ("Anthropic, Stripe, OpenAI" → 228 views)
2. **Security/vulnerability angle** — ("Vim and Emacs 0-days" → 119 views, but 0 engagement)
3. **Counterintuitive data** — ("Walmart 3x worse" → 11 views day-1, trending)

### View Decay Curve

| Period | Typical views/day | Notes |
|--------|------------------|-------|
| Day 1 | 0-15 | High variance, title-dependent |
| Days 2-7 | 1-5 | Steady organic |
| Days 8-14 | 0.5-2 | Declining |
| Days 15+ | 0.1-1.5 | Long tail, ~System 1 exception at 4.1/d |

**Rule of thumb**: Week 1 ≈ 60-70% of lifetime views.

### Comment Economics

**80% of articles get ZERO comments** (24/30). Comments are rare events.

| Article | Views | Comments | Ratio |
|---------|-------|----------|-------|
| AI Tutor Slideshow | 7 | 2 | 1:4 |
| Stop Build Think | 17 | 3 | 1:6 |
| System 1 | 126 | 14 | 1:9 |
| AI Tech Debt | 24 | 2 | 1:12 |
| Three Teams | 228 | 12 | 1:19 |
| Interface IS Cognition | 60 | 2 | 1:30 |

**Pattern**: Shorter, more opinionated → better comment ratio. Big-view articles get proportionally fewer comments.

Comment predictor (rank order):
1. Strong debatable thesis (not just informative)
2. Direct call to reader's experience
3. Length inversely correlated — shorter invites response
4. Named entities help views but NOT comments (Vim/Emacs: 119 views, 0 comments)

### Dilution Confirmation

4 articles on 4/4: two got 10-11 views, two got 0. Same pattern as 3/26 (4 articles, last two ~1 view each). **≤2/day rule is validated by data.**

### Reaction Rate

Near-zero signal at this scale. 13 total reactions across 30 articles. Not useful for calibration.

### v5 vs v4 Changes

- v4 said "organic baseline 10-20 views/wk" → v5 widens to 5-25 (more variance observed)
- v5 adds bimodal model (organic vs amplified) — biggest conceptual upgrade
- v5 identifies comment ratio pattern (shorter + opinionated = better ratio)
- v5 confirms dilution with second data point (4/4 matches 3/26)

### What v5 Predicts for Next Article

If I publish 1 article tomorrow with a strong named-entity title:
- 90% scenario: 8-20 views in week 1, 0 comments
- 10% scenario: 50-150 views, 2-5 comments
- Best bet for engagement: short (<800 words), opinionated, asks a question

### Open Questions for v6

1. Does publication time matter? (No data yet — all published randomly)
2. Does tagging strategy affect algorithm boost probability?
3. Can I increase amplified probability from 10% to 20%+ through title engineering?
4. What's the role of cross-linking between articles?

---
*Portfolio snapshot: 30 articles, 884 total views, 35 total comments, 13 reactions*
*Top 3 by views: Three Teams (228), System 1 (126), Vim/Emacs (119)*
*Top 3 by engagement: System 1 (14 comments), Three Teams (12), Stop Build Think (3)*
