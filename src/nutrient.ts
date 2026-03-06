import fs from 'node:fs';
import path from 'node:path';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';

interface LaneOutputResult {
  id?: string;
  type?: string;
  status?: string;
  output?: string;
  completedAt?: string;
}

interface NutrientSignal {
  ts: string;
  signal: 'delegation-nutrient';
  actionPresent: boolean;
  laneOutputCount: number;
  absorbedCount: number;
  absorptionRate: number;
  absorbedTaskIds: string[];
}

function resolveInstancePath(fileName: string): string | null {
  try {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) return null;
    return path.join(getInstanceDir(instanceId), fileName);
  } catch {
    return null;
  }
}

function safeAppendJsonl(filePath: string, payload: unknown): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(payload) + '\n', 'utf-8');
  } catch {
    // fire-and-forget
  }
}

function loadLaneOutputs(instanceId: string): LaneOutputResult[] {
  try {
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    if (!fs.existsSync(laneDir)) return [];

    const files = fs.readdirSync(laneDir).filter((f) => f.endsWith('.json'));
    const results: LaneOutputResult[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(laneDir, file), 'utf-8');
        results.push(JSON.parse(raw) as LaneOutputResult);
      } catch {
        // skip malformed files
      }
    }

    return results;
  } catch {
    return [];
  }
}

function isAbsorbed(result: LaneOutputResult, combinedText: string): boolean {
  const id = (result.id ?? '').toLowerCase();
  if (id && combinedText.includes(id)) return true;

  const type = (result.type ?? '').toLowerCase();
  if (type && combinedText.includes(type)) return true;

  const output = (result.output ?? '').toLowerCase();
  if (!output) return false;

  const tokens = output
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 6)
    .slice(0, 20);

  if (tokens.length === 0) return false;
  const overlap = tokens.filter(t => combinedText.includes(t)).length;
  return overlap >= 2;
}

export function trackNutrientSignals(action: string | null, response: string): void {
  setImmediate(() => {
    try {
      const instanceId = getCurrentInstanceId();
      if (!instanceId) return;

      const outputs = loadLaneOutputs(instanceId);
      if (outputs.length === 0) return;

      const combinedText = `${action ?? ''}\n${response}`.toLowerCase();
      const absorbed = outputs.filter(o => isAbsorbed(o, combinedText));

      const signal: NutrientSignal = {
        ts: new Date().toISOString(),
        signal: 'delegation-nutrient',
        actionPresent: !!action,
        laneOutputCount: outputs.length,
        absorbedCount: absorbed.length,
        absorptionRate: Number((absorbed.length / outputs.length).toFixed(3)),
        absorbedTaskIds: absorbed.map(o => o.id).filter((id): id is string => !!id),
      };

      const outPath = resolveInstancePath('nutrient-signals.jsonl');
      if (!outPath) return;
      safeAppendJsonl(outPath, signal);
    } catch {
      // fire-and-forget
    }
  });
}
