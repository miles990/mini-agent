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

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { diagLog, slog } from './utils.js';

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
 * 執行單一 perception script（async，不阻塞 event loop）
 * stdout 即結果，失敗時回傳 null（不影響其他 perception）
 */
export async function executePerception(
  perception: CustomPerception,
  cwd?: string,
): Promise<PerceptionResult> {
  const timeout = perception.timeout ?? 10000;
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
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        scriptPath,
        [],
        {
          encoding: 'utf-8',
          timeout,
          cwd: cwd ?? process.cwd(),
          maxBuffer: 1024 * 1024, // 1MB
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(Object.assign(error, { stderr }));
          } else {
            resolve(stdout);
          }
        },
      );
    });

    return {
      name: perception.name,
      output: output.trim() || null,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const shortErr = msg.split('\n')[0].slice(0, 200);
    const errObj = error as { stderr?: string; killed?: boolean; signal?: string; code?: number | null };
    const stderr = errObj.stderr?.trim()?.slice(0, 200) ?? '';
    // Timeout kills are normal degradation, not errors — only log unexpected failures
    if (errObj.killed && errObj.signal === 'SIGTERM') {
      slog('PERCEPTION', `[timeout] ${perception.name} killed after ${timeout}ms`);
    } else {
      diagLog('perception.exec', error, {
        script: perception.name,
        stderr,
        killed: String(errObj.killed ?? ''),
        signal: errObj.signal ?? '',
      });
    }
    return {
      name: perception.name,
      output: null,
      error: shortErr,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * 批次執行所有 custom perceptions（並行，Promise.all）
 * 每個獨立執行，失敗不影響其他
 */
export async function executeAllPerceptions(
  perceptions: CustomPerception[],
  cwd?: string,
): Promise<PerceptionResult[]> {
  return Promise.all(perceptions.map(p => executePerception(p, cwd)));
}

/**
 * 將 perception 結果格式化為 XML context sections
 */
const PLUGIN_OUTPUT_CAP = 4000; // 4K chars per plugin — prevents context bloat

export function formatPerceptionResults(
  results: PerceptionResult[],
  capOverrides?: Record<string, number>,
): string {
  return results
    .filter(r => r.output) // 只包含有輸出的
    .map(r => {
      const cap = capOverrides?.[r.name] ?? PLUGIN_OUTPUT_CAP;
      const output = r.output!.length > cap
        ? r.output!.slice(0, cap) + '\n[... truncated]'
        : r.output!;
      return `<${r.name}>\n${output}\n</${r.name}>`;
    })
    .join('\n\n');
}

// =============================================================================
// Skill Loader — Dynamic Loading with Self-Describing Metadata
// =============================================================================

/**
 * 動態載入的 skill，包含自描述 metadata
 * - keywords: 從 "JIT Keywords:" 行解析，用於 keyword-based JIT 篩選
 * - modes: 從 "JIT Modes:" 行解析，用於 cycle mode 篩選
 * - 支援 hot-reload（mtime 追蹤）和目錄自動掃描
 */
export interface LoadedSkill {
  name: string;
  content: string;       // 注入 prompt 的內容（JIT metadata 行已剝離）
  keywords: string[];    // 從 "JIT Keywords:" 解析
  modes: string[];       // 從 "JIT Modes:" 解析（learn/act/task/respond/reflect）
  filePath: string;      // 絕對路徑（hot-reload 用）
  mtime: number;         // 檔案修改時間（hot-reload 用）
}

/**
 * 從 skill 內容解析 JIT metadata 行
 * 格式：
 *   JIT Keywords: keyword1, keyword2, ...
 *   JIT Modes: learn, act, task
 * 這些行從注入內容中剝離（只是 metadata，不是 instructions）
 */
function parseSkillMetadata(rawContent: string): {
  content: string;
  keywords: string[];
  modes: string[];
} {
  const lines = rawContent.split('\n');
  const keywords: string[] = [];
  const modes: string[] = [];
  const contentLines: string[] = [];

  for (const line of lines) {
    const kwMatch = line.match(/^JIT Keywords:\s*(.+)$/i);
    const modeMatch = line.match(/^JIT Modes:\s*(.+)$/i);

    if (kwMatch) {
      keywords.push(
        ...kwMatch[1].split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
      );
    } else if (modeMatch) {
      modes.push(
        ...modeMatch[1].split(',').map(m => m.trim().toLowerCase()).filter(Boolean),
      );
    } else {
      contentLines.push(line);
    }
  }

  return {
    content: contentLines.join('\n').trim(),
    keywords,
    modes,
  };
}

/**
 * 載入單一 Markdown skill 檔案（含 metadata 解析）
 */
function loadSkill(resolvedPath: string): LoadedSkill | null {
  if (!fs.existsSync(resolvedPath)) return null;

  try {
    const rawContent = fs.readFileSync(resolvedPath, 'utf-8').trim();
    const name = path.basename(resolvedPath, path.extname(resolvedPath));
    const stat = fs.statSync(resolvedPath);
    const { content, keywords, modes } = parseSkillMetadata(rawContent);

    return { name, content, keywords, modes, filePath: resolvedPath, mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * 掃描目錄中的所有 .md 檔案
 */
function scanSkillsDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(dirPath, f));
  } catch {
    return [];
  }
}

/**
 * 解析 skill 路徑列表 — 支援檔案和目錄混合
 * 目錄會自動掃描其中的 .md 檔案
 */
export function resolveSkillPaths(paths: string[], cwd?: string): string[] {
  const resolved: string[] = [];
  const base = cwd ?? process.cwd();

  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.resolve(base, p);
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        resolved.push(...scanSkillsDir(abs));
      } else {
        resolved.push(abs);
      }
    } catch {
      // Skip non-existent paths
    }
  }
  return [...new Set(resolved)]; // dedupe
}

/**
 * 批次載入所有 skills — 支援目錄自動掃描
 */
export function loadAllSkills(
  skillPaths: string[],
  cwd?: string,
): LoadedSkill[] {
  const resolvedPaths = resolveSkillPaths(skillPaths, cwd);
  return resolvedPaths
    .map(p => loadSkill(p))
    .filter((s): s is LoadedSkill => s !== null);
}

// --- Hot-reload state ---
let _trackingPaths: string[] = [];
let _trackingCwd: string | undefined;
let _lastScanMs = 0;

/** 設定 skill 路徑追蹤（啟動時呼叫） */
export function setSkillTrackingPaths(paths: string[], cwd?: string): void {
  _trackingPaths = paths;
  _trackingCwd = cwd;
}

/**
 * 檢查 skill 檔案是否有變更，有的話重新載入
 * 每 10 秒最多檢查一次，變更時回傳新 cache，否則回傳 null
 */
export function refreshSkillsCache(currentCache: LoadedSkill[]): LoadedSkill[] | null {
  if (_trackingPaths.length === 0) return null;

  const now = Date.now();
  if (now - _lastScanMs < 10_000) return null;
  _lastScanMs = now;

  // 重新掃描目錄（捕捉新增/刪除的 .md 檔案）
  const resolvedPaths = resolveSkillPaths(_trackingPaths, _trackingCwd);
  const currentPathSet = new Set(currentCache.map(s => s.filePath));
  const newPathSet = new Set(resolvedPaths);

  let changed = currentPathSet.size !== newPathSet.size;

  // 檢查新增/刪除
  if (!changed) {
    for (const p of newPathSet) {
      if (!currentPathSet.has(p)) { changed = true; break; }
    }
  }

  // 檢查 mtime 變更
  if (!changed) {
    for (const skill of currentCache) {
      try {
        const stat = fs.statSync(skill.filePath);
        if (stat.mtimeMs !== skill.mtime) { changed = true; break; }
      } catch {
        changed = true; break; // 檔案被刪
      }
    }
  }

  if (!changed) return null;

  // 重新載入
  const reloaded = resolvedPaths
    .map(p => loadSkill(p))
    .filter((s): s is LoadedSkill => s !== null);

  slog('SKILLS', `Hot-reloaded ${reloaded.length} skill(s): ${reloaded.map(s => s.name).join(', ')}`);
  return reloaded;
}

/**
 * 將 skills 格式化為 system prompt 片段
 */
export function formatSkillsPrompt(skills: Array<{ name: string; content: string }>): string {
  if (skills.length === 0) return '';

  const sections = skills.map(s => s.content).join('\n\n---\n\n');
  return `\n\n## Your Skills\n\n${sections}\n`;
}

/**
 * 生成 skill 索引（name-only 格式）
 * 只列出名稱，不包含關鍵字或描述。~10 chars/skill。
 * 完整內容由 JIT keyword matching 在需要時載入。
 */
export function formatSkillIndex(skills: LoadedSkill[]): string {
  if (skills.length === 0) return '';
  return `\nAvailable skills: ${skills.map(s => s.name).join(', ')}\n`;
}
