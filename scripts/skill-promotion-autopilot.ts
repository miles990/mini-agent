import { getMemoryRootDir } from '../src/memory-paths.js';
import {
  maybeQueueSkillPromotion,
  summarizeSkillPromotionAutopilot,
  sweepSkillPromotionBacktests,
} from '../src/skill-promotion-autopilot.js';

const args = new Set(process.argv.slice(2));
const memoryDir = getMemoryRootDir();

if (args.has('--queue')) {
  const result = await maybeQueueSkillPromotion(memoryDir, {
    triggerReason: 'skill-promotion-cli',
    dryRun: args.has('--dry-run'),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else if (args.has('--sweep')) {
  const result = await sweepSkillPromotionBacktests(memoryDir);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  process.stdout.write(JSON.stringify(summarizeSkillPromotionAutopilot(memoryDir), null, 2) + '\n');
}
