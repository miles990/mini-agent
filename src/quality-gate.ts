/**
 * Quality Gate — Pipeline output quality checks
 *
 * Pluggable check[] array. Runs before delivering any output to the user
 * (foreground or OODA lane). Default checks are registered on module load.
 *
 * Architecture:
 * - checks stored in a module-level array
 * - registerCheck pushes to array
 * - qualityCheck iterates array, collects all failing reasons
 */

import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface QualityCheck {
  name: string;
  check(output: string, context: QualityContext): { pass: boolean; reason: string };
}

export interface QualityContext {
  source: string;
  inputLength: number;
  isCode: boolean;
  lane: 'foreground' | 'ooda';
}

export interface QualityCheckResult {
  pass: boolean;
  issues: string[];
  checksRun: number;
}

// =============================================================================
// Registry
// =============================================================================

const checks: QualityCheck[] = [];

export function registerCheck(check: QualityCheck): void {
  checks.push(check);
}

export function getChecks(): QualityCheck[] {
  return checks;
}

// =============================================================================
// Default checks
// =============================================================================

/** output.trim().length > 10 */
export const nonEmptyCheck: QualityCheck = {
  name: 'non-empty',
  check(output) {
    const len = output.trim().length;
    return len > 10
      ? { pass: true, reason: 'ok' }
      : { pass: false, reason: `output too short (${len} chars)` };
  },
};

/** No raw stack traces or rate-limit messages */
export const noErrorLeakCheck: QualityCheck = {
  name: 'no-error-leak',
  check(output) {
    const stackPattern = /at\s+\S+\s+\(.*:\d+:\d+\)|Error:.*\n\s+at\s/;
    if (stackPattern.test(output)) {
      return { pass: false, reason: 'raw error/stack trace leaked' };
    }
    const rateLimitPattern = /rate.?limit|you['']ve hit your limit|overloaded|credit balance/i;
    if (rateLimitPattern.test(output)) {
      return { pass: false, reason: 'rate limit message leaked' };
    }
    return { pass: true, reason: 'ok' };
  },
};

/** Known kuro tags stripped; no residual XML-like tags remain */
const KURO_TAG_PATTERN =
  /<\/?kuro:[a-z][a-z_-]*(?:\s[^>]*)?>|<kuro:[a-z][a-z_-]*(?:\s[^>]*)?\/>/gi;

export const noXmlResidueCheck: QualityCheck = {
  name: 'no-xml-residue',
  check(output) {
    const stripped = output.replace(KURO_TAG_PATTERN, '');
    const residuePattern = /<\/?[a-z][a-z_-]*[\s>]/i;
    if (residuePattern.test(stripped)) {
      return { pass: false, reason: 'residual XML tags in output' };
    }
    return { pass: true, reason: 'ok' };
  },
};

/** Only when context.isCode: no TODO / FIXME / PLACEHOLDER / XXX / HACK */
export const noPlaceholderCheck: QualityCheck = {
  name: 'no-placeholder',
  check(output, context) {
    if (!context.isCode) return { pass: true, reason: 'skipped (not code)' };
    const pattern = /\b(TODO|FIXME|PLACEHOLDER|XXX|HACK)\b/;
    if (pattern.test(output)) {
      return { pass: false, reason: 'code contains placeholder markers' };
    }
    return { pass: true, reason: 'ok' };
  },
};

// Register defaults on module load
registerCheck(nonEmptyCheck);
registerCheck(noErrorLeakCheck);
registerCheck(noXmlResidueCheck);
registerCheck(noPlaceholderCheck);

// =============================================================================
// Main entry point
// =============================================================================

export function qualityCheck(output: string, context: QualityContext): QualityCheckResult {
  const issues: string[] = [];

  for (const check of checks) {
    const result = check.check(output, context);
    if (!result.pass) {
      issues.push(result.reason);
    }
  }

  const pass = issues.length === 0;
  slog('quality-gate', `${context.lane}/${context.source} pass=${pass} checks=${checks.length} issues=${issues.length}`,
    issues.length > 0 ? { issues } : undefined,
  );

  return { pass, issues, checksRun: checks.length };
}
