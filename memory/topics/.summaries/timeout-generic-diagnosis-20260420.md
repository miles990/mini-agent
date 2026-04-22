<!-- Auto-generated summary — 2026-04-21 -->
# timeout-generic-diagnosis-20260420

This diagnostic reveals that loop-lane timeouts stem from prompt context inflation during retries, with actual prompts reaching 89k characters despite a 45k hard cap—suggesting the safety pre-check either fails silently or doesn't properly truncate. The immediate fix is a one-line categorization improvement (silent_exit detection), but the real issue requires identifying whether the prompt-size hard cap is bypassed during retry rebuilds or the minimal-context path doesn't honor its budget constraints.
