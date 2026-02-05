/**
 * Cron Task Manager
 *
 * 管理 agent-compose.yaml 中定義的定時任務
 */

import cron from 'node-cron';
import { processMessage } from './agent.js';
import { getLogger } from './logging.js';
import type { CronTask } from './types.js';

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
      console.log(`[Cron] Skipped (disabled): ${task.task.slice(0, 30)}...`);
      continue;
    }

    // 驗證 cron 表達式
    if (!cron.validate(task.schedule)) {
      console.error(`[Cron] Invalid schedule: ${task.schedule}`);
      continue;
    }

    const job = cron.schedule(task.schedule, async () => {
      console.log(`[Cron] Running: ${task.task.slice(0, 50)}...`);
      logger.logCron('cron-task', task.task.slice(0, 100), task.schedule);

      try {
        const response = await processMessage(task.task);
        console.log(`[Cron] Done: ${response.content.slice(0, 50)}...`);
        logger.logCron('cron-task-result', response.content.slice(0, 200), task.schedule, {
          success: true,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Cron] Error: ${errorMsg}`);
        logger.logCron('cron-task-error', errorMsg, task.schedule, {
          success: false,
          error: errorMsg,
        });
      }
    });

    activeTasks.push({ task, job });
    console.log(`[Cron] Scheduled: "${task.task.slice(0, 30)}..." (${task.schedule})`);
  }

  if (activeTasks.length > 0) {
    console.log(`[Cron] ${activeTasks.length} task(s) active`);
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
    console.log(`[Cron] Stopped ${activeTasks.length} task(s)`);
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
    console.log(`[Cron] Running: ${task.task.slice(0, 50)}...`);
    logger.logCron('cron-task', task.task.slice(0, 100), task.schedule);

    try {
      const response = await processMessage(task.task);
      console.log(`[Cron] Done: ${response.content.slice(0, 50)}...`);
      logger.logCron('cron-task-result', response.content.slice(0, 200), task.schedule, {
        success: true,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Cron] Error: ${errorMsg}`);
      logger.logCron('cron-task-error', errorMsg, task.schedule, {
        success: false,
        error: errorMsg,
      });
    }
  });

  activeTasks.push({ task, job });
  console.log(`[Cron] Added: "${task.task.slice(0, 30)}..." (${task.schedule})`);

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

  console.log(`[Cron] Removed: "${removed.task.task.slice(0, 30)}..."`);
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
    console.log(`[Cron] Reloaded: +${added} -${removed} =${unchanged}`);
    logger.logCron('cron-reload', `added=${added}, removed=${removed}, unchanged=${unchanged}`);
  }

  return { added, removed, unchanged };
}
