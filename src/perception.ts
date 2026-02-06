/**
 * Perception Plugin System
 *
 * Shell Script Perception: 任何可執行檔案都能成為感知插件
 * - stdout 即結果，包在 <tag>...</tag> 中注入 context
 * - 支援任何語言（bash, python, go binary...）
 * - 錯誤隔離：子進程失敗不影響其他 perception
 *
 * Markdown Skill: 知識模組注入 system prompt
 * - 純 Markdown 檔案，檔名即 skill 名稱
 * - 直接注入到 Claude 的 system prompt 中
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// =============================================================================
// Types
// =============================================================================

export interface CustomPerception {
  name: string;
  script: string;      // 腳本路徑（相對或絕對）
  interval?: string;   // 執行間隔（預留，目前每次都執行）
  timeout?: number;    // 超時毫秒（預設 5000）
}

export interface PerceptionResult {
  name: string;
  output: string | null;
  error?: string;
  durationMs: number;
}

// =============================================================================
// Shell Perception Executor
// =============================================================================

/**
 * 執行單一 perception script
 * stdout 即結果，失敗時回傳 null（不影響其他 perception）
 */
export function executePerception(
  perception: CustomPerception,
  cwd?: string,
): PerceptionResult {
  const timeout = perception.timeout ?? 5000;
  const startTime = Date.now();

  // 解析腳本路徑（相對路徑基於 cwd）
  const scriptPath = path.isAbsolute(perception.script)
    ? perception.script
    : path.resolve(cwd ?? process.cwd(), perception.script);

  // 檢查檔案存在
  if (!fs.existsSync(scriptPath)) {
    return {
      name: perception.name,
      output: null,
      error: `Script not found: ${scriptPath}`,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const output = execSync(scriptPath, {
      encoding: 'utf-8',
      timeout,
      cwd: cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'], // 捕獲 stderr
      maxBuffer: 1024 * 1024, // 1MB
    });

    return {
      name: perception.name,
      output: output.trim() || null,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // 擷取簡短錯誤（不要整個 stack trace）
    const shortErr = msg.split('\n')[0].slice(0, 200);
    return {
      name: perception.name,
      output: null,
      error: shortErr,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * 批次執行所有 custom perceptions
 * 每個獨立執行，失敗不影響其他
 */
export function executeAllPerceptions(
  perceptions: CustomPerception[],
  cwd?: string,
): PerceptionResult[] {
  return perceptions.map(p => executePerception(p, cwd));
}

/**
 * 將 perception 結果格式化為 XML context sections
 */
export function formatPerceptionResults(results: PerceptionResult[]): string {
  return results
    .filter(r => r.output) // 只包含有輸出的
    .map(r => `<${r.name}>\n${r.output}\n</${r.name}>`)
    .join('\n\n');
}

// =============================================================================
// Skill Loader
// =============================================================================

/**
 * 載入 Markdown skill 檔案
 * 檔名即 skill 名稱，內容直接注入 system prompt
 */
export function loadSkill(skillPath: string, cwd?: string): { name: string; content: string } | null {
  const resolved = path.isAbsolute(skillPath)
    ? skillPath
    : path.resolve(cwd ?? process.cwd(), skillPath);

  if (!fs.existsSync(resolved)) {
    return null;
  }

  try {
    const content = fs.readFileSync(resolved, 'utf-8').trim();
    const name = path.basename(resolved, path.extname(resolved));
    return { name, content };
  } catch {
    return null;
  }
}

/**
 * 批次載入所有 skills
 */
export function loadAllSkills(
  skillPaths: string[],
  cwd?: string,
): Array<{ name: string; content: string }> {
  return skillPaths
    .map(p => loadSkill(p, cwd))
    .filter((s): s is { name: string; content: string } => s !== null);
}

/**
 * 將 skills 格式化為 system prompt 片段
 */
export function formatSkillsPrompt(skills: Array<{ name: string; content: string }>): string {
  if (skills.length === 0) return '';

  const sections = skills.map(s => s.content).join('\n\n---\n\n');
  return `\n\n## Your Skills\n\n${sections}\n`;
}
