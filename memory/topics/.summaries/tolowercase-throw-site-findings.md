<!-- Auto-generated summary — 2026-04-25 -->
# tolowercase-throw-site-findings

This document identifies three high-priority `toLowerCase()` throw sites where potentially undefined values can cause runtime errors in `loop.ts` and `feedback-loops.ts`, located in critical paths like schedule tag parsing and error classification. The analysis provides surgical patches using null-coalescing operators (`??`) to guard against undefined values, with a success metric of error rate dropping from 72 over 7 days after fixes are applied. The remaining lower-risk locations are deferred as they're already guarded or called with well-typed inputs.
