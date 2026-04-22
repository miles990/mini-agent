<!-- Auto-generated summary — 2026-04-22 -->
# system-reminder-split-plan

This plan splits how system context reaches the model to prevent trust boundary violations: internal hooks and task state flow through the SDK's `systemPrompt` channel (out-of-band, unforgeable), while external inputs (room messages, inbox, delegate results) stay in `userMessage` but have system tags sanitized (HTML-encoded) to prevent injection attacks. The implementation requires migrating hook output in `src/loop.ts`, sanitizing ingress points like `src/inbox-processor.ts`, and testing both self-injection and external-injection scenarios as regression guards.
