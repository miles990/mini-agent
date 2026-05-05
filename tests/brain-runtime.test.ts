import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decideArbitration } from '../src/brain-arbiter.js';
import { BrainRuntime } from '../src/brain-runtime.js';
import { readBrainRunEventsSync } from '../src/brain-run-ledger.js';
import { readProviderClaimsSync } from '../src/claim-ledger.js';
import type {
  BrainProvider,
  BrainRequest,
  BrainResult,
  ProviderId,
  WorkItem,
} from '../src/brain-types.js';
import type { PeerAgent } from '../src/peer-agent.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-brain-runtime-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'task-1',
    title: 'Implement runtime',
    intent: 'code',
    priority: 'P1',
    risk: 'workspace_write',
    writeScope: ['src/brain-runtime.ts'],
    ...overrides,
  };
}

function request(overrides: Partial<BrainRequest> = {}): BrainRequest {
  return {
    taskId: 'task-1',
    source: 'background',
    intent: 'code',
    prompt: 'Implement runtime',
    systemPrompt: 'system',
    cwd: '/repo',
    timeoutMs: 1000,
    risk: 'workspace_write',
    tools: ['read', 'write'],
    ...overrides,
  };
}

function provider(
  id: ProviderId,
  overrides: Partial<BrainProvider> & { text?: string; available?: boolean } = {},
): BrainProvider {
  const run = overrides.run ?? vi.fn(async (req: BrainRequest): Promise<BrainResult> => ({
    provider: id,
    text: overrides.text ?? `${id} completed ${req.taskId}`,
    toolCalls: [],
    durationMs: 5,
    finishReason: 'success',
  }));

  return {
    id,
    capabilities: {
      canWrite: true,
      canUseShell: true,
      canUseMcp: false,
      bestFor: ['code', 'diagnose', 'verify'],
    },
    run,
    abort: overrides.abort ?? vi.fn(async () => undefined),
    health: overrides.health ?? vi.fn(async () => ({
      available: overrides.available ?? true,
      detail: overrides.available === false ? `${id} disabled` : undefined,
    })),
  };
}

function peer(overrides: Partial<PeerAgent> = {}): PeerAgent {
  return {
    id: overrides.id ?? 'akari',
    health: overrides.health ?? vi.fn(async () => ({ available: true })),
    consult: overrides.consult ?? vi.fn(async () => ({
      peer: overrides.id ?? 'akari',
      response: 'Architecture critique',
      critiques: ['missing runtime seam'],
      recommendations: ['add runtime'],
      claims: [{
        subject: 'BrainRuntime',
        predicate: 'centralizes',
        object: 'provider dispatch',
        evidence: ['peer review'],
        confidence: 0.8,
      }],
    })),
  };
}

describe('BrainRuntime', () => {
  it('falls back from an unavailable primary and writes provider claims', async () => {
    const codex = provider('codex', { available: false });
    const claude = provider('claude', { text: 'Claude fallback completed runtime' });
    const item = work();
    const decision = decideArbitration(item);

    const result = await new BrainRuntime({
      providers: [codex, claude],
      memoryDir: tmpDir,
    }).execute({ workItem: item, request: request(), decision });

    expect(result.status).toBe('partial');
    expect(result.primary).toBe('claude');
    expect(result.runs).toEqual([
      expect.objectContaining({ actor: 'codex', status: 'skipped' }),
      expect.objectContaining({ actor: 'claude', status: 'success' }),
    ]);
    expect(readProviderClaimsSync(tmpDir, { provider: 'claude' })).toEqual([
      expect.objectContaining({
        provider: 'claude',
        taskId: 'task-1',
        predicate: 'reported_result',
        object: 'Claude fallback completed runtime',
      }),
    ]);
    expect(readBrainRunEventsSync(tmpDir, { taskId: 'task-1' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'runtime_started', selectionTrace: expect.any(Object) }),
        expect.objectContaining({ event: 'runtime_finished', status: 'partial' }),
        expect.objectContaining({ event: 'actor_finished', intent: 'code', actor: 'codex', status: 'skipped' }),
        expect.objectContaining({ event: 'actor_finished', intent: 'code', actor: 'claude', status: 'success' }),
      ]),
    );
    expect(readBrainRunEventsSync(tmpDir, { taskId: 'task-1', event: 'runtime_started' })[0]).toEqual(
      expect.objectContaining({
        decisionBudget: expect.objectContaining({
          maxActors: 2,
          stopWhen: 'verified',
        }),
      }),
    );
  });

  it('runs architecture panels across providers and peer agents', async () => {
    const item = work({ intent: 'architecture', risk: 'read_only', writeScope: undefined });
    const decision = decideArbitration(item);

    const result = await new BrainRuntime({
      providers: [provider('claude'), provider('codex')],
      peers: [peer({ id: 'akari' }), peer({ id: 'tanren' })],
      memoryDir: tmpDir,
    }).execute({ workItem: item, request: request({ intent: 'architecture', risk: 'read_only' }), decision });

    expect(result.status).toBe('success');
    expect(result.primary).toBe('kuro');
    expect(result.runs.map(run => run.actor)).toEqual(['akari', 'claude', 'codex', 'kuro']);
    expect(result.runs.at(-1)).toEqual(expect.objectContaining({
      actor: 'kuro',
      role: 'coordinator',
      status: 'success',
    }));
    expect(readProviderClaimsSync(tmpDir).map(claim => claim.provider)).toEqual(
      expect.arrayContaining(['claude', 'codex', 'akari', 'kuro']),
    );
  });

  it('converts reviewer requests to read-only provider runs', async () => {
    const reviewerRun = vi.fn(async (req: BrainRequest): Promise<BrainResult> => ({
      provider: 'claude',
      text: `reviewed with ${req.risk}`,
      toolCalls: [],
      durationMs: 5,
      finishReason: 'success',
    }));
    const item = work();
    const decision = decideArbitration(item);

    await new BrainRuntime({
      providers: [provider('codex'), provider('claude', { run: reviewerRun })],
      memoryDir: tmpDir,
    }).execute({ workItem: item, request: request(), decision });

    expect(reviewerRun).toHaveBeenCalledWith(expect.objectContaining({
      risk: 'read_only',
      tools: ['read'],
    }));
    expect(reviewerRun.mock.calls[0]?.[0].prompt).toContain('Review the proposed work');
  });

  it('injects synced myelin decision patterns into provider context', async () => {
    writeJson('myelin-routing-rules.json', [
      { id: 'rule-route', action: 'foreground', hitCount: 120, reason: 'low-risk replies stay foreground' },
    ]);
    writeLines('myelin-routing-decisions.jsonl', [
      { _type: 'decision', ts: '2026-05-05T00:00:00.000Z', method: 'rule', action: 'foreground' },
    ]);
    writeJson('state/myelin-kg-sync.json', {
      rules: {
        'routing:rule-route:foreground': {
          hitCount: 120,
          syncedAt: '2026-05-05T00:00:00.000Z',
        },
      },
    });
    const run = vi.fn(async (req: BrainRequest): Promise<BrainResult> => ({
      provider: 'codex',
      text: req.systemPrompt,
      toolCalls: [],
      durationMs: 5,
      finishReason: 'success',
    }));
    const item = work({ risk: 'read_only', writeScope: undefined });

    await new BrainRuntime({
      providers: [provider('codex', { run })],
      memoryDir: tmpDir,
    }).execute({
      workItem: item,
      request: request({ risk: 'read_only', tools: ['read'] }),
      decision: {
        mode: 'solo',
        primary: 'codex',
        candidates: [],
        reviewers: [],
        reason: 'test direct provider context',
        writeLeaseRequired: false,
        kgClaimsRequired: true,
        humanApprovalRequired: false,
      },
    });

    expect(run.mock.calls[0]?.[0].systemPrompt).toContain('<myelin-decision-patterns>');
    expect(run.mock.calls[0]?.[0].systemPrompt).toContain('routing: prefer "foreground"');
    expect(readBrainRunEventsSync(tmpDir, { event: 'context_injected' })).toEqual([
      expect.objectContaining({
        actor: 'codex',
        contextSources: ['myelin'],
        contextPreview: [expect.stringContaining('routing: prefer "foreground"')],
      }),
    ]);
  });

  it('skips execution when human approval is required', async () => {
    const item = work({ risk: 'deploy' });
    const result = await new BrainRuntime({
      providers: [provider('codex')],
      memoryDir: tmpDir,
    }).execute({ workItem: item, request: request({ risk: 'deploy' }), decision: decideArbitration(item) });

    expect(result.status).toBe('skipped');
    expect(result.runs).toEqual([
      expect.objectContaining({ actor: 'human', status: 'skipped' }),
    ]);
    expect(readProviderClaimsSync(tmpDir)).toEqual([]);
  });
});

function writeJson(file: string, value: unknown): void {
  const filePath = path.join(tmpDir, file);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function writeLines(file: string, records: unknown[]): void {
  const filePath = path.join(tmpDir, file);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');
}
