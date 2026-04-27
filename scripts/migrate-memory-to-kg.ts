#!/usr/bin/env bun
import { syncMemoryToKG } from '../src/kg-memory.js';

const agent = process.argv[2] ?? 'kuro';
const memoryDir = process.argv[3] ?? './memory';

console.log(`Migrating memory for agent "${agent}" from ${memoryDir} → KG...`);

const result = await syncMemoryToKG({ agent, memoryDir });
console.log(`Done: ${result.synced} synced, ${result.skipped} skipped`);
