/**
 * Cron Task Manager
 *
 * 管理 agent-compose.yaml 中定義的定時任務
 */

import cron from 'node-cron';
import { dispatch } from './dispatcher.js';
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

    const job = cron.schedule(task.schedule, async () => {
      slog('CRON', `⏰ Triggered: "${task.task.slice(0, 60)}"`);
      eventBus.emit('trigger:cron', { schedule: task.schedule, task: task.task.slice(0, 100) });
      logger.logCron('cron-task', task.task.slice(0, 100), task.schedule);
      logger.logBehavior('system', 'cron.trigger', `[${task.schedule}] ${task.task.slice(0, 100)}`);
      const cronStart = Date.now();

      try {
        const response = await dispatch({ message: task.task, source: 'cron' });
        const elapsed = ((Date.now() - cronStart) / 1000).toFixed(1);
        slog('CRON', `✓ Done (${elapsed}s): "${response.content.slice(0, 80)}"`);
        logger.logCron('cron-task-result', response.content.slice(0, 200), task.schedule, {
          success: true,
          duration: Date.now() - cronStart,
        });

        // TG 通知：解析 [ACTION] tag
        await notifyCronAction(response.content);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        slog('CRON', `✗ Error: ${errorMsg}`);
        logger.logCron('cron-task-error', errorMsg, task.schedule, {
          success: false,
          error: errorMsg,
        });
        await notifyCronError(task.task, errorMsg);
      }
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

  const job = cron.schedule(task.schedule, async () => {
    slog('CRON', `⏰ Triggered: "${task.task.slice(0, 60)}"`);
    logger.logCron('cron-task', task.task.slice(0, 100), task.schedule);
    logger.logBehavior('system', 'cron.trigger', `[${task.schedule}] ${task.task.slice(0, 100)}`);
    const cronStart = Date.now();

    try {
      const response = await dispatch({ message: task.task, source: 'cron' });
      const elapsed = ((Date.now() - cronStart) / 1000).toFixed(1);
      slog('CRON', `✓ Done (${elapsed}s): "${response.content.slice(0, 80)}"`);
      logger.logCron('cron-task-result', response.content.slice(0, 200), task.schedule, {
        success: true,
        duration: Date.now() - cronStart,
      });

      // TG 通知：解析 [ACTION] tag
      await notifyCronAction(response.content);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      slog('CRON', `✗ Error: ${errorMsg}`);
      logger.logCron('cron-task-error', errorMsg, task.schedule, {
        success: false,
        error: errorMsg,
      });
      await notifyCronError(task.task, errorMsg);
    }
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

/**
 * CRON 任務完成後解析 [ACTION] tag — 正常結果走 summary
 */
async function notifyCronAction(content: string): Promise<void> {
  const actionMatch = content.match(/\[ACTION\](.*?)\[\/ACTION\]/s);
  if (actionMatch) {
    const action = actionMatch[1].trim();
    await notify(`⏰ ${action}`, 'summary');
  }
  // [CHAT] — dispatch/postProcess 已處理，不重複
}

/**
 * CRON 任務異常 — 走 signal 即時通知
 */
async function notifyCronError(taskDesc: string, errorMsg: string): Promise<void> {
  await notify(`🔴 Cron 異常：${taskDesc.slice(0, 60)}\n${errorMsg.slice(0, 200)}`, 'signal');
}
