/**
 * File Watcher - 監聽 agent-compose.yaml 變化
 *
 * 支援熱重載 cron 任務
 */

import fs from 'node:fs';
import path from 'node:path';
import { findComposeFile, readComposeFile } from './compose.js';
import { reloadCronTasks } from './cron.js';
import type { CronTask } from './types.js';

let watcher: fs.FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let lastContent: string = '';

/**
 * 開始監聽 compose 檔案
 */
export function startComposeWatcher(composeFilePath?: string): { watching: string | null } {
  const filePath = composeFilePath || findComposeFile();

  if (!filePath) {
    console.log('[Watcher] No compose file found, skipping watch');
    return { watching: null };
  }

  // 如果已經在監聽，先停止
  stopComposeWatcher();

  // 記錄初始內容（用於比較）
  try {
    lastContent = fs.readFileSync(filePath, 'utf-8');
  } catch {
    lastContent = '';
  }

  // 開始監聽
  watcher = fs.watch(filePath, (eventType) => {
    if (eventType !== 'change') return;

    // Debounce：避免多次觸發
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      handleComposeChange(filePath);
    }, 300);
  });

  console.log(`[Watcher] Watching: ${filePath}`);
  return { watching: filePath };
}

/**
 * 停止監聽
 */
export function stopComposeWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[Watcher] Stopped');
  }
}

/**
 * 處理 compose 檔案變化
 */
function handleComposeChange(filePath: string): void {
  try {
    // 讀取新內容
    const newContent = fs.readFileSync(filePath, 'utf-8');

    // 如果內容沒變，跳過
    if (newContent === lastContent) {
      return;
    }

    lastContent = newContent;
    console.log('[Watcher] Detected change in compose file');

    // 解析並重新載入 cron 任務
    const compose = readComposeFile(filePath);

    // 收集所有 agent 的 cron 任務
    const allCronTasks: CronTask[] = [];
    for (const agent of Object.values(compose.agents)) {
      if (agent.cron && agent.cron.length > 0) {
        allCronTasks.push(...agent.cron);
      }
    }

    // 熱重載
    const result = reloadCronTasks(allCronTasks);

    if (result.added > 0 || result.removed > 0) {
      console.log(`[Watcher] Cron tasks updated: +${result.added} -${result.removed}`);
    }
  } catch (error) {
    console.error('[Watcher] Error reloading compose:', error instanceof Error ? error.message : error);
  }
}

/**
 * 取得監聽狀態
 */
export function getWatcherStatus(): { active: boolean; path: string | null } {
  return {
    active: watcher !== null,
    path: watcher ? lastContent.slice(0, 50) + '...' : null,
  };
}
