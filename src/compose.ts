/**
 * Agent Compose - Docker Compose 風格的多 agent 管理
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ComposeFile, ComposeAgent } from './types.js';
import { getInstanceManager } from './instance.js';

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_COMPOSE_FILE = 'agent-compose.yaml';

export const DEFAULT_COMPOSE_TEMPLATE: ComposeFile = {
  version: '1',
  agents: {
    default: {
      name: 'Default Agent',
      port: 3001,
      role: 'standalone',
      persona: 'A helpful personal AI assistant',
    },
  },
};

export const EXAMPLE_COMPOSE_TEMPLATE: ComposeFile = {
  version: '1',
  agents: {
    researcher: {
      name: 'Research Agent',
      port: 3001,
      role: 'standalone',
      persona: 'Specializes in web research and information gathering',
      proactive: {
        schedule: '0 9,18 * * *',
      },
    },
    coder: {
      name: 'Coding Agent',
      port: 3002,
      role: 'standalone',
      persona: 'Specializes in code review and development',
      depends_on: ['researcher'],
    },
    coordinator: {
      name: 'Coordinator',
      port: 3003,
      role: 'master',
      persona: 'Coordinates tasks between other agents',
    },
  },
  memory: {
    shared: {
      path: '~/.mini-agent/shared',
      sync: true,
    },
  },
};

// =============================================================================
// Compose File Operations
// =============================================================================

/**
 * 尋找 compose 檔案
 */
export function findComposeFile(specifiedFile?: string): string | null {
  if (specifiedFile) {
    const resolved = path.resolve(specifiedFile);
    return fs.existsSync(resolved) ? resolved : null;
  }

  // 嘗試預設檔名
  const defaultPath = path.resolve(DEFAULT_COMPOSE_FILE);
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
}

/**
 * 讀取 compose 檔案
 */
export function readComposeFile(filePath: string): ComposeFile {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseYaml(content) as ComposeFile;
}

/**
 * 產生 compose 模板
 */
export function generateComposeTemplate(example = false): string {
  const template = example ? EXAMPLE_COMPOSE_TEMPLATE : DEFAULT_COMPOSE_TEMPLATE;

  const header = `# Agent Compose File
# 使用方式: mini-agent up [-d]
# 參考: https://github.com/miles990/mini-agent

`;

  return header + stringifyYaml(template);
}

/**
 * 建立預設的 compose 檔案
 */
export function createDefaultComposeFile(targetPath?: string, example = false): string {
  const filePath = targetPath || path.resolve(DEFAULT_COMPOSE_FILE);
  const content = generateComposeTemplate(example);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// =============================================================================
// Compose Operations
// =============================================================================

export interface ComposeUpResult {
  started: string[];
  failed: Array<{ id: string; error: string }>;
  skipped: string[];
}

/**
 * 依照 depends_on 排序 agents
 */
function sortAgentsByDependency(agents: Record<string, ComposeAgent>): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Circular dependency detected: ${id}`);
    }

    visiting.add(id);
    const agent = agents[id];
    if (agent?.depends_on) {
      for (const dep of agent.depends_on) {
        if (!agents[dep]) {
          throw new Error(`Unknown dependency: ${dep} (required by ${id})`);
        }
        visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const id of Object.keys(agents)) {
    visit(id);
  }

  return sorted;
}

/**
 * 啟動 compose 中定義的所有 agents
 */
export function composeUp(compose: ComposeFile, detached = false): ComposeUpResult {
  const manager = getInstanceManager();
  const result: ComposeUpResult = {
    started: [],
    failed: [],
    skipped: [],
  };

  // 排序（處理 depends_on）
  let sortedIds: string[];
  try {
    sortedIds = sortAgentsByDependency(compose.agents);
  } catch (err) {
    throw new Error(`Dependency error: ${err instanceof Error ? err.message : err}`);
  }

  // 取得已存在的實例
  const existingInstances = new Map(
    manager.list().map(inst => [inst.name, inst])
  );

  for (const agentId of sortedIds) {
    const agentDef = compose.agents[agentId];
    const agentName = agentDef.name || agentId;

    // 檢查是否已存在同名實例
    const existing = existingInstances.get(agentName);
    if (existing) {
      // 如果已在運行，跳過
      if (manager.isRunning(existing.id)) {
        result.skipped.push(agentId);
        continue;
      }
      // 如果存在但未運行，啟動它
      try {
        manager.start(existing.id);
        result.started.push(agentId);
      } catch (err) {
        result.failed.push({
          id: agentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    // 建立新實例
    try {
      const instance = manager.create({
        name: agentName,
        port: agentDef.port,
        role: agentDef.role,
        persona: agentDef.persona,
      });

      // create 已經會自動啟動，所以直接標記為 started
      result.started.push(agentId);
    } catch (err) {
      result.failed.push({
        id: agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * 停止 compose 中定義的所有 agents
 */
export function composeDown(compose: ComposeFile): ComposeUpResult {
  const manager = getInstanceManager();
  const result: ComposeUpResult = {
    started: [], // 這裡用來表示成功停止的
    failed: [],
    skipped: [],
  };

  // 取得已存在的實例（按名稱映射）
  const existingInstances = new Map(
    manager.list().map(inst => [inst.name, inst])
  );

  // 反向順序停止（先停依賴者）
  const agentIds = Object.keys(compose.agents).reverse();

  for (const agentId of agentIds) {
    const agentDef = compose.agents[agentId];
    const agentName = agentDef.name || agentId;

    const existing = existingInstances.get(agentName);
    if (!existing) {
      result.skipped.push(agentId);
      continue;
    }

    if (!manager.isRunning(existing.id)) {
      result.skipped.push(agentId);
      continue;
    }

    try {
      manager.stop(existing.id);
      result.started.push(agentId); // 用 started 表示成功停止
    } catch (err) {
      result.failed.push({
        id: agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * 顯示 compose 狀態
 */
export function composeStatus(compose: ComposeFile): Array<{
  id: string;
  name: string;
  port: number;
  status: 'running' | 'stopped' | 'not_created';
  instanceId?: string;
  pid?: number;
}> {
  const manager = getInstanceManager();
  const instances = manager.list();
  const instanceByName = new Map(instances.map(inst => [inst.name, inst]));

  return Object.entries(compose.agents).map(([id, def]) => {
    const name = def.name || id;
    const existing = instanceByName.get(name);

    if (!existing) {
      return {
        id,
        name,
        port: def.port || 3001,
        status: 'not_created' as const,
      };
    }

    const running = manager.isRunning(existing.id);
    const status = manager.getStatus(existing.id);

    return {
      id,
      name,
      port: existing.port,
      status: running ? 'running' as const : 'stopped' as const,
      instanceId: existing.id,
      pid: status?.pid,
    };
  });
}
