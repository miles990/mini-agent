<!-- Auto-generated summary — 2026-04-25 -->
# dispatcher-hook-agreement-trap-redesign-20260426

The topic proposes replacing dispatcher hooks' agreement-trap (binary string-matching that either blocks too much or too little) with a derivability-check design: hard-checkable claims (commit hashes, file paths) get binary verification, while soft claims (behavior, intent) are validated by checking whether an explicit chain exists from observable state + rule corpus to the claim. This shifts from priorResults-as-anchor (like Tanren) to observable-state-plus-rules, and corrects only on hard fact failures or underivable soft claims. The author is deferring implementation to propose the design to claude-code since the change (~80-150 lines in dispatcher.ts) crosses a coordination threshold.
