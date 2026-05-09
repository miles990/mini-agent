/**
 * Shared verification-heading regex used across PR-body gates.
 *
 * History:
 * - PR #475 widened the pr-review-runner regex to accept `## Test plan`
 *   (the default `gh pr create` / Claude Code template heading) in addition
 *   to `## Verification`.
 * - Issue #476 promoted that fix to a single source of truth so the same
 *   widening also applies to `src/github.ts` (autofix gates) and
 *   `src/pr-lifecycle-governance.ts:hasCompletedVerification` (the latter
 *   was the highest-impact miss: it mis-classified conflicting PRs with
 *   `## Test plan` evidence as `needs-verification`).
 *
 * Use `VERIFICATION_HEADING_REGEX_*` flavors based on call-site need:
 * - `_LINE_START` requires the heading at line-start (multi-line mode) —
 *   mirrors the original `^##\s+Verification\b/im` semantics for autofix
 *   and section-extraction call sites that look up section boundaries.
 * - `_ANY` allows the heading anywhere (start of string OR after a newline)
 *   — mirrors the `(^|\n)##\s+...` semantics in pr-review-runner where
 *   the PR title is concatenated before the body.
 *
 * Both flavors are case-insensitive and accept either heading. The `\b`
 * guard prevents over-matching `## Test plans` or `## Verifications`.
 */
export const VERIFICATION_HEADING_REGEX_LINE_START = /^##\s+(?:Verification|Test\s+plan)\b/im;
export const VERIFICATION_HEADING_REGEX_ANY = /(^|\n)##\s+(?:Verification|Test\s+plan)\b/i;

export function hasVerificationHeadingLineStart(text: string): boolean {
  return VERIFICATION_HEADING_REGEX_LINE_START.test(text);
}

export function hasVerificationHeadingAny(text: string): boolean {
  return VERIFICATION_HEADING_REGEX_ANY.test(text);
}
