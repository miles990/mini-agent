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
