import { recordPublicWriteProvenance } from '../src/public-write-identity.js';
import { getMemoryRootDir } from '../src/memory-paths.js';

const args = parseArgs(process.argv.slice(2));
if (!args.service || !args.action || !args.subject || !args.actual) {
  process.stderr.write('usage: pnpm tsx scripts/record-public-write-identity.ts --service github --action pr.create --subject PR#261 --actual miles990 [--expected kuro-agent] [--source connector] [--status open|resolved|acknowledged] [--resolution text]\n');
  process.exit(2);
}

const record = recordPublicWriteProvenance(getMemoryRootDir(), {
  service: args.service,
  action: args.action,
  subject: args.subject,
  actualActor: args.actual,
  expectedActor: args.expected,
  source: args.source ?? 'manual-observation',
  status: args.status as 'open' | 'resolved' | 'acknowledged' | undefined,
  resolution: args.resolution,
  evidence: args.evidence ? [args.evidence] : [],
});

console.log(JSON.stringify(record, null, 2));

function parseArgs(raw: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = raw[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}
