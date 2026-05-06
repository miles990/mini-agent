import path from 'node:path';
import { evaluateCorrectionGate, type ShipTruthState } from './correction-gate.js';
import { slog } from './utils.js';

export interface ShipTruthLanguageGateResult {
  text: string;
  changed: boolean;
  reason: string | null;
  shipTruth: ShipTruthState | null;
}

export interface ShipTruthLanguageGateOptions {
  memoryDir?: string;
  repoRoot?: string;
  shipTruth?: ShipTruthState | null;
}

const SHIP_CLAIM_RE = /\b(?:shipped|deployed|verified-live)\b|已上線|完成上線|部署完成|已部署|ship\s*了|上線完成/i;

export function applyShipTruthLanguageGate(
  text: string,
  options: ShipTruthLanguageGateOptions = {},
): ShipTruthLanguageGateResult {
  if (!SHIP_CLAIM_RE.test(text)) {
    return { text, changed: false, reason: null, shipTruth: options.shipTruth ?? null };
  }

  const shipTruth = options.shipTruth ?? readCurrentShipTruth(options);
  if (!shipTruth) {
    return { text, changed: false, reason: null, shipTruth: null };
  }

  if (shipTruth.state === 'clean') {
    return { text, changed: false, reason: null, shipTruth };
  }

  const stateLabel = labelShipTruthState(shipTruth);
  const corrected = text
    .replace(/\bshipped\b/gi, stateLabel)
    .replace(/\bdeployed\b/gi, stateLabel)
    .replace(/\bverified-live\b/gi, stateLabel)
    .replace(/已上線|完成上線|部署完成|已部署|ship\s*了|上線完成/g, stateLabel);

  const suffix = `\n\n[ship-truth] state=${shipTruth.state}; branch=${shipTruth.branch ?? 'unknown'}; ahead=${shipTruth.ahead}; behind=${shipTruth.behind}; dirty=${shipTruth.dirty}. Delivery label: "${stateLabel}".`;
  const gatedText = corrected.includes('[ship-truth]') ? corrected : `${corrected}${suffix}`;
  slog('SHIP-TRUTH', `language gate corrected claim: ${shipTruth.state}`);

  return {
    text: gatedText,
    changed: true,
    reason: `blocked ship claim while ship truth is ${shipTruth.state}`,
    shipTruth,
  };
}

function readCurrentShipTruth(options: ShipTruthLanguageGateOptions): ShipTruthState | null {
  const repoRoot = options.repoRoot ?? process.cwd();
  const memoryDir = options.memoryDir ?? path.join(repoRoot, 'memory');
  try {
    return evaluateCorrectionGate(memoryDir, repoRoot).shipTruth;
  } catch {
    return null;
  }
}

function labelShipTruthState(shipTruth: ShipTruthState): string {
  if (shipTruth.state === 'pending-push') return 'committed-local/pending-push';
  if (shipTruth.state === 'dirty') return 'pushed-with-dirty-worktree';
  if (shipTruth.state === 'behind') return 'behind-origin';
  if (shipTruth.state === 'diverged') return 'diverged-with-origin';
  if (shipTruth.state === 'not-repo') return 'unverified-non-repo';
  return 'unverified';
}
