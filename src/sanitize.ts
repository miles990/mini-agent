/**
 * Surrogate sanitization for direct Anthropic SDK callers in mini-agent.
 *
 * Mirrors `agent-middleware/src/sdk-provider.ts:sanitizeUnpairedSurrogates`
 * (commit c6e1f92). mini-agent does not depend on agent-middleware as a
 * package, so the helper is duplicated here. Both copies must stay in sync.
 *
 * Anthropic API rejects strings containing lone UTF-16 surrogates with
 * HTTP 400 "no low surrogate in string". Surrogates appear when buffers
 * are sliced mid-code-point (emoji, CJK). Replace with U+FFFD.
 */
export function sanitizeUnpairedSurrogates(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
    .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1\uFFFD');
}
