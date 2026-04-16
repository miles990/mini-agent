# WR2 Accuracy + Logic Weakness Analysis

**Date**: 2026-04-16
**Scope**: 4 comp 3 (WR2) audits — celery_1345, 1349, 1350, 1352
**Goal**: Find root causes of acc=4.4, logic=4.4 and design Phase 2 fixes

## Data Summary

| Audit | Topic | Bloom | Slides | Grok | Cross-Section Recommend? |
|-------|-------|-------|--------|------|--------------------------|
| 1345 | Overfitting/Underfitting | R,U | 30 | 2 fixes (×99→×100) | yes |
| 1349 | Overfitting/Underfitting | R,U | 34 | 0 fixes | **no** |
| 1350 | 99% Accuracy Bad Model | U,R | 30 | 2 fixes (364→365 days) | yes |
| 1352 | 99% Accuracy Bad Model | U,Ap,An,Ev,R | 30 | 0 fixes | **no** |

## Surviving Issues (in final video)

### A. Empty Narration → Generic Fill (3/4 audits)
- celery_1349 slide 7, celery_1350 slide 3, celery_1352 slide 27
- Server guard fills with heading or "Take a moment to look at this slide"
- **Root**: Section writers produce slides with heading but no narration
- **Impact**: Weak engagement, logic gaps, evaluator notices dead air

### B. Precision/Recall Logic Confusion (celery_1352 slide 28)
- "missing a real email from your friend...so precision matters more"
- WRONG: missing email = false negative = RECALL problem, not precision
- Grok says "All facts verified" — it's a logic error, not factual
- **Impact**: Direct acc + logic hit. Teaches wrong conclusion.

### C. Fractional Discrete Counts + Wrong Math (celery_1352 slide 25)
- "28.6 of those 50 are actual cheaters" — people aren't fractional
- "28.6 out of 50, which equals 0.6 or 60%" — actual: 28.6/50 = 0.572
- Double error: impossible count + wrong division
- **Impact**: Direct accuracy hit

### D. Number Instability Across Examples (celery_1350)
- Fire alarm 99.7% (364/365) vs spam filter 99% (9900/10000)
- Transitions between examples unclear, numbers bleed
- **Impact**: Logic score — student can't track which numbers belong to which story

### E. Layout Tags in Narration (celery_1349)
- "MIDDLE: Degree-3" "RIGHT: Degree-15" — layout labels read aloud
- Empty slide 32 heading with no narration
- **Impact**: Engagement + logic

## Fixed by Existing Gates (confirmed in server logs)

- "multiply by 99" → "multiply by 100" (Grok, 2/2 applied)
- "364 days in a year" → "365 days" (Grok, 2/2 applied)  
- Empty narration slides filled by server guard (4 slides total)

## Root Cause Architecture

```
Section Writers (Step 2a, parallel)
  ↓ produce empty narration, tag leaks, number drift
Per-Section Check (generate-script.mjs:2268)
  ↓ catches arithmetic/formula/ceiling — NOT empty narration or logic errors
Cross-Section Review (generate-script.mjs:2346)
  ↓ catches issues as "blocking" — Haiku repair unreliable for logic errors
Server Gates (server.mjs:730-825)
  ↓ math gate → factcheck (factual only) → empty narration (generic fill)
Video Generation
  → evaluator AI sees remaining issues
```

**Gap 1**: No gate checks for empty narration before cross-section review  
**Gap 2**: Factcheck only checks facts, not logical consistency  
**Gap 3**: No check for impossible discrete counts (fractional people)  
**Gap 4**: Server-level empty narration recovery is too generic  

## Fix Plan

### P0-A: Empty Narration Prevention (perSectionCheck)
- In `perSectionCheck()`, after code gates, detect slides with empty narration
- Add them to the LLM review prompt with explicit instruction to fill them
- **File**: generate-script.mjs:2268-2342

### P0-B: Fractional Discrete Count Detection (code-checks.mjs)
- New mechanical check: pattern `\b\d+\.\d+\s+(people|students|days|emails|cases|patients|cheaters|players|items|fires|alarms)`
- Flag for correction in cross-section or per-section check
- **File**: code-checks.mjs, add check #10

### P0-C: Logic-Aware Factcheck (grokFactCheck)
- Expand Grok system prompt: "Also verify that when teaching definitions (precision, recall, accuracy, etc.), the examples and conclusions correctly match the definitions. Flag logic errors where the stated conclusion contradicts the definition."
- **File**: generate-script.mjs:2163

### P1-A: Contextual Empty Narration Recovery (server.mjs)
- Replace generic fill with targeted LLM call using heading + surrounding slides as context
- Haiku is fast enough, won't add significant latency
- **File**: server.mjs:788-825

### P1-B: Layout Tag Stripping (sanitizeSlideFields)
- Add regex to strip `^(LEFT|MIDDLE|RIGHT|CENTER):\s*` from narration
- Strip `\[/?VISUAL\]` tags
- **File**: generate-script.mjs:914-970

## Expected Impact
- P0-A + P1-A: Eliminate 3/4 audits' empty narration → engage + logic up
- P0-B: Catch fractional people → accuracy up  
- P0-C: Catch precision/recall confusion → accuracy + logic up
- P1-B: Clean output → engagement up
- Combined: acc from 4.4 → target 4.7, logic from 4.4 → target 4.7
