/**
 * delegation-converter.draft — P1-d K2: tag-to-dispatch converter (v2-final §6.4 Q-S2/Q-S3)
 *
 * Status: DRAFT, not imported, not runtime-active.
 * Replaces src/delegation.ts spawn path at cutover.
 *
 * Contract:
 *   <kuro:delegate type=X> tag → capability defaults → middleware.dispatch → taskId sync
 *
 * Forge lifecycle split (§6.3): mini-agent still allocates worktree for `code`
 * workers (sync call pre-dispatch); middleware owns status/recover/watchdog.
 *
 * Open wire-spec items for CC (non-blocking for this file):
 *   - DispatchResponse.taskId vs locally generated id — current draft returns
 *     middleware-assigned id; caller must treat taskId as opaque.
 *   - tools / maxTurns / provider — not on DispatchRequest yet; middleware
 *     worker registry is expected to own capability defaults server-side.
 */

import { createMiddlewareClient, type DispatchRequest } from './middleware-client.js';
import type { DelegationTaskType } from './types.js';

// Caller surface preserved at cutover (dispatcher.ts x2, loop.ts x1).
export interface DelegationTaskInput {
  type?: DelegationTaskType;
  prompt: string;
  workdir: string;
  timeoutMs?: number;
}

// Forge allocation stays Kuro-local (§6.3). Injected to keep this file free of
// fs/child_process side effects until wiring cycle.
export type ForgeAllocator = (taskType: DelegationTaskType, workdir: string) => string | null;

const DEFAULT_TIMEOUT_MS: Record<DelegationTaskType, number> = {
  code: 300_000, learn: 300_000, research: 480_000, create: 480_000,
  review: 180_000, shell: 60_000, browse: 180_000, akari: 480_000,
  plan: 300_000, debug: 300_000,
};

export async function convertAndDispatch(
  task: DelegationTaskInput,
  forgeAllocate: ForgeAllocator,
): Promise<string> {
  const worker = (task.type ?? 'code') as DelegationTaskType;
  const forgeCwd = worker === 'code' ? forgeAllocate('code', task.workdir) : null;
  const cwd = (forgeCwd ?? task.workdir).replace(/^~/, process.env.HOME ?? '');
  const req: DispatchRequest = {
    worker,
    task: task.prompt,
    cwd,
    timeoutSeconds: Math.ceil((task.timeoutMs ?? DEFAULT_TIMEOUT_MS[worker]) / 1000),
  };
  const res = await createMiddlewareClient().dispatch(req);
  return res.taskId;
}
