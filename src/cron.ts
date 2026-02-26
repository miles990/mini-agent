/**
 * Cron Task Manager
 *
 * 管理 agent-compose.yaml 中定義的定時任務
 *
 * Queue-Drain 模式：cron 觸發時排入 queue，OODA cycle 結束後 drain。
 * 解決 loopBusy guard 導致 cron 被擋的問題。
 */

import cron from 'node-cron';
import { postProcess } from './dispatcher.js';
import { callClaude } from './agent.js';
import { buildContext } from './memory.js';
import { getLogger } from './logging.js';
import { slog } from './api.js';
import { diagLog } from './utils.js';
import { notifyTelegram, notify, flushSummary } from './telegram.js';
import type { CronTask } from './types.js';
import { eventBus } from './event-bus.js';

interface ScheduledCronTask {
  task: CronTask;
  job: cron.ScheduledTask;
}

// =============================================================================
// Cron Queue — 排隊等 OODA cycle 結束後執行
// =============================================================================

interface QueuedCronTask {
  task: CronTask;
  queuedAt: number;
  retries: number;
}

const cronQueue: QueuedCronTask[] = [];
const MAX_QUEUE_SIZE = 10;
const MAX_RETRIES = 2;

let activeTasks: ScheduledCronTask[] = [];

/**
 * 啟動 cron 任務
 */
export function startCronTasks(tasks: CronTask[]): void {
  const logger = getLogger();

  // 先停止現有任務
  stopCronTasks();

  for (const task of tasks) {
    // 跳過 disabled 的任務
    if (task.enabled === false) {
      slog('CRON', `Skipped (disabled): ${task.task.slice(0, 40)}`);
      continue;
    }

    // 驗證 cron 表達式
    if (!cron.validate(task.schedule)) {
      slog('CRON', `Invalid schedule: ${task.schedule}`);
      continue;
    }

    const job = cron.schedule(task.schedule, () => {
      enqueueCronTask(task);
    });

    activeTasks.push({ task, job });
    slog('CRON', `Scheduled: "${task.task.slice(0, 50)}" (${task.schedule})`);
  }

  // Summary flush cron — 每 6 小時送出累積的 summary 通知
  const flushJob = cron.schedule('0 */6 * * *', async () => {
    const digest = flushSummary();
    if (digest) {
      slog('CRON', `📋 Flushing summary buffer`);
      await notifyTelegram(digest);
    }
  });
  activeTasks.push({
    task: { schedule: '0 */6 * * *', task: '[internal] Flush notification summary buffer' },
    job: flushJob,
  });

  if (activeTasks.length > 0) {
    slog('CRON', `${activeTasks.length} task(s) active`);
  }
}

/**
 * 停止所有 cron 任務
 */
export function stopCronTasks(): void {
  for (const { job } of activeTasks) {
    job.stop();
  }
  if (activeTasks.length > 0) {
    slog('CRON', `Stopped ${activeTasks.length} task(s)`);
  }
  activeTasks = [];
}

/**
 * 取得目前活躍的任務
 */
export function getActiveCronTasks(): CronTask[] {
  return activeTasks.map(({ task }) => task);
}

/**
 * 取得任務數量
 */
export function getCronTaskCount(): number {
  return activeTasks.length;
}

/**
 * 動態新增單一 cron 任務
 */
export function addCronTask(task: CronTask): { success: boolean; error?: string } {
  const logger = getLogger();

  // 跳過 disabled 的任務
  if (task.enabled === false) {
    return { success: false, error: 'Task is disabled' };
  }

  // 驗證 cron 表達式
  if (!cron.validate(task.schedule)) {
    return { success: false, error: `Invalid schedule: ${task.schedule}` };
  }

  // 檢查是否已存在相同任務（避免重複）
  const exists = activeTasks.some(
    t => t.task.schedule === task.schedule && t.task.task === task.task
  );
  if (exists) {
    return { success: false, error: 'Task already exists' };
  }

  const job = cron.schedule(task.schedule, () => {
    enqueueCronTask(task);
  });

  activeTasks.push({ task, job });
  slog('CRON', `Added: "${task.task.slice(0, 50)}" (${task.schedule})`);

  return { success: true };
}

/**
 * 移除 cron 任務（by index 或 by schedule+task）
 */
export function removeCronTask(index: number): { success: boolean; error?: string };
export function removeCronTask(schedule: string, taskContent: string): { success: boolean; error?: string };
export function removeCronTask(
  indexOrSchedule: number | string,
  taskContent?: string
): { success: boolean; error?: string } {
  let targetIndex: number;

  if (typeof indexOrSchedule === 'number') {
    targetIndex = indexOrSchedule;
  } else {
    targetIndex = activeTasks.findIndex(
      t => t.task.schedule === indexOrSchedule && t.task.task === taskContent
    );
  }

  if (targetIndex < 0 || targetIndex >= activeTasks.length) {
    return { success: false, error: 'Task not found' };
  }

  const removed = activeTasks[targetIndex];
  removed.job.stop();
  activeTasks.splice(targetIndex, 1);

  slog('CRON', `Removed: "${removed.task.task.slice(0, 50)}"`);;
  return { success: true };
}

/**
 * 重新載入 cron 任務（熱重載用）
 */
export function reloadCronTasks(tasks: CronTask[]): { added: number; removed: number; unchanged: number } {
  const logger = getLogger();

  // 建立現有任務的 key 集合
  const existingKeys = new Set(
    activeTasks.map(t => `${t.task.schedule}::${t.task.task}`)
  );

  // 建立新任務的 key 集合
  const newKeys = new Set(
    tasks.filter(t => t.enabled !== false).map(t => `${t.schedule}::${t.task}`)
  );

  let added = 0;
  let removed = 0;
  let unchanged = 0;

  // 移除不在新配置中的任務
  for (let i = activeTasks.length - 1; i >= 0; i--) {
    const key = `${activeTasks[i].task.schedule}::${activeTasks[i].task.task}`;
    if (!newKeys.has(key)) {
      activeTasks[i].job.stop();
      activeTasks.splice(i, 1);
      removed++;
    } else {
      unchanged++;
    }
  }

  // 新增不在現有任務中的任務
  for (const task of tasks) {
    if (task.enabled === false) continue;

    const key = `${task.schedule}::${task.task}`;
    if (!existingKeys.has(key)) {
      const result = addCronTask(task);
      if (result.success) {
        added++;
      }
    }
  }

  if (added > 0 || removed > 0) {
    slog('CRON', `Reloaded: +${added} -${removed} =${unchanged}`);
    logger.logCron('cron-reload', `added=${added}, removed=${removed}, unchanged=${unchanged}`);
  }

  return { added, removed, unchanged };
}

// =============================================================================
// Queue management — enqueue + drain
// =============================================================================

/** 將 cron 任務排入 queue（由 cron schedule handler 呼叫） */
function enqueueCronTask(task: CronTask): void {
  // 避免同一任務重複排隊
  const isDuplicate = cronQueue.some(
    q => q.task.schedule === task.schedule && q.task.task === task.task,
  );
  if (isDuplicate) {
    slog('CRON', `⏭ Already queued: "${task.task.slice(0, 60)}"`);
    return;
  }

  // Queue 滿了則丟棄最舊的
  if (cronQueue.length >= MAX_QUEUE_SIZE) {
    const dropped = cronQueue.shift();
    slog('CRON', `⚠ Queue full, dropped: "${dropped?.task.task.slice(0, 60)}"`);
  }

  cronQueue.push({ task, queuedAt: Date.now(), retries: 0 });
  slog('CRON', `⏰ Queued (${cronQueue.length}): "${task.task.slice(0, 60)}"`);
  eventBus.emit('trigger:cron', { schedule: task.schedule, task: task.task.slice(0, 100) });
}

/**
 * Drain 一個 queued cron task — 由 OODA cycle 結束後呼叫。
 * 每次只執行一個，避免 blocking 太久。
 * Fire-and-forget，失敗 retry 最多 MAX_RETRIES 次。
 */
export async function drainCronQueue(): Promise<void> {
  if (cronQueue.length === 0) return;

  const item = cronQueue.shift()!;
  const logger = getLogger();
  const cronStart = Date.now();

  logger.logCron('cron-task', item.task.task.slice(0, 100), item.task.schedule);
  logger.logBehavior('system', 'cron.execute', `[${item.task.schedule}] ${item.task.task.slice(0, 100)} (attempt ${item.retries + 1})`);

  try {
    const context = await buildContext();
    const result = await callClaude(item.task.task, context, 2, { source: 'loop' });

    // Busy guard 仍然擋住 → re-queue with retry
    if (result.duration === 0 && result.response.includes('稍後再試')) {
      if (item.retries < MAX_RETRIES) {
        item.retries++;
        cronQueue.push(item);
        slog('CRON', `⏭ Re-queued (retry ${item.retries}): "${item.task.task.slice(0, 60)}"`);
      } else {
        slog('CRON', `✗ Dropped after ${MAX_RETRIES} retries: "${item.task.task.slice(0, 60)}"`);
      }
      return;
    }

    const response = await postProcess(item.task.task, result.response, {
      lane: 'cron', duration: result.duration, source: 'cron',
      systemPrompt: result.systemPrompt, context,
    });
    const elapsed = ((Date.now() - cronStart) / 1000).toFixed(1);
    slog('CRON', `✓ Done (${elapsed}s): "${response.content.slice(0, 80)}"`);
    logger.logCron('cron-task-result', response.content.slice(0, 200), item.task.schedule, {
      success: true,
      duration: Date.now() - cronStart,
    });

    await notifyCronAction(response.content);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    slog('CRON', `✗ Error: ${errorMsg}`);
    logger.logCron('cron-task-error', errorMsg, item.task.schedule, {
      success: false,
      error: errorMsg,
    });

    // Retry on error
    if (item.retries < MAX_RETRIES) {
      item.retries++;
      cronQueue.push(item);
      slog('CRON', `⏭ Re-queued after error (retry ${item.retries}): "${item.task.task.slice(0, 60)}"`);
    } else {
      await notifyCronError(item.task.task, errorMsg);
    }
  }
}

/** 取得 queue 中待執行的任務數 */
export function getCronQueueSize(): number {
  return cronQueue.length;
}

/**
 * CRON 任務完成後解析 <kuro:action> tag — 正常結果走 summary
 */
async function notifyCronAction(content: string): Promise<void> {
  const actionMatch = content.match(/<kuro:action>([\s\S]*?)<\/kuro:action>/);
  if (actionMatch) {
    const action = actionMatch[1].trim();
    await notify(`⏰ ${action}`, 'summary');
  }
  // <kuro:chat> — dispatch/postProcess 已處理，不重複
}

/**
 * CRON 任務異常 — 走 signal 即時通知
 */
async function notifyCronError(taskDesc: string, errorMsg: string): Promise<void> {
  await notify(`🔴 Cron 異常：${taskDesc.slice(0, 60)}\n${errorMsg.slice(0, 200)}`, 'signal');
}
