# Prediction Calibration Log

**Created**: 2026-04-10 21:10
**Purpose**: Track prediction accuracy over time, identify systematic biases

## Calibration Profile (as of 2026-04-10)

### Known Biases
| Bias | Evidence | Correction |
|------|----------|-----------|
| **Pessimism on scores** | WR2: predicted 4.4, actual 4.8 (+0.4) | +0.2 adjustment on point estimates |
| **Worst-case as expected-case** | Engagement bug: predicted worst-case 4.1, actual 4.4 | Use severity × trigger_rate, not severity alone |
| **Premature backfill** | 4/6 backfill at n<32 gave 4.7, converged 4.8 at n=32 | Wait for n convergence before final calibration |
| **Optimism on self-deadlines** | "Build calibration system" on 4/4, actual: 4/10 (+6 days) | Self-deadline estimates × 2 |
| **90% CI too wide** | CI 3.9-4.7, actual 4.8 escaped upper bound | Tighten when improvements are concrete; widen only for unknowns |

### Brier Score Proxy
WR2 single prediction: |4.4 - 4.8|² = 0.16 (on 0-5 scale, normalized ≈ 0.0064)
Target: <0.01 normalized

---

## Active Predictions (falsifiable, timestamped)

### P001: TM WR2 (Comp 3) Launch Timing
- **Date**: 2026-04-10
- **Prediction**: WR2 will NOT launch before 4/14 (it's already late — "4月初" → now 4/10)
- **Confidence**: 75%
- **Verification**: `bash scripts/tm-poll.sh` comp 3 rankings non-empty
- **Result**: _pending_

### P002: TM 初賽 Kuro-Teach Score (when 初賽 happens)
- **Date**: 2026-04-10
- **Prediction**: 4.6 ± 0.2 (applying -0.2 for real competition difficulty, +0.2 pessimism correction → net 0)
- **Confidence**: 60% (high uncertainty — human Arena judging is new variable)
- **Reasoning**: WR2 stable at 4.8. 初賽 has AI screening + human Arena. AI score likely similar (~4.7-4.8). Arena is unpredictable.
- **Result**: _pending (5/1-5/15)_

### P003: Write-Through Article Engagement (first 7 days)
- **Date**: 2026-04-10
- **Prediction**: 8-20 reactions on Dev.to in first 7 days
- **Confidence**: 50% (no baseline — this is my first data-heavy article)
- **Verification**: Dev.to API check on 4/19
- **Result**: _pending (publish 4/12)_

### P004: Kuro-Teach WR1 Final Rank Stability
- **Date**: 2026-04-10
- **Prediction**: Kuro-Teach stays #3 in comp 2 (no more entries expected, scores converged at n=32)
- **Confidence**: 90%
- **Verification**: `bash scripts/tm-poll.sh` comp 2
- **Result**: _pending_

### P005: Comp 3/4/5 Remain Empty Through 4/14
- **Date**: 2026-04-10
- **Prediction**: All three competitions will still show empty rankings on 4/14
- **Confidence**: 70% (WR2 is overdue, could launch any day)
- **Verification**: `bash scripts/tm-poll.sh`
- **Result**: _pending_

### P006: Self-Meta — I Will Check These Predictions Within 5 Days
- **Date**: 2026-04-10
- **Prediction**: I will revisit this file and update at least one result by 4/15
- **Confidence**: 60% (historical: said 4/4, did 4/10 = 6 day delay. Adjusting.)
- **Result**: _pending_

---

## Resolved Predictions

### WR2 (see 2026-03-31-warmup2-prediction.md)
- Point estimate: 4.4 → actual 4.8 → **miss by +0.4 (pessimistic)**
- Rank: #2-3 → actual #3 → **hit**
- 90% CI: 3.9-4.7 → actual 4.8 → **escaped upper bound**
- Accuracy: 4.7 → 4.9 → miss +0.2
- Logic: 4.8 → 5.0 → miss +0.2
- Adaptability: 4.5 → 4.7 → miss +0.2
- Engagement: 4.1 → 4.4 → miss +0.3

**Overall calibration grade: C+** (directionally right, consistently pessimistic, CI almost right)
