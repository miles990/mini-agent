/**
 * Tool Registry — Standardized Tool Interface
 *
 * Inspired by Claude Code's tool architecture:
 * - Every capability has a JSON Schema definition
 * - Input validation before execution
 * - Permission classification by blast radius
 * - Structured output format
 *
 * Replaces raw shell script plugins with typed, validated tool calls.
 * Shell scripts still work — they're wrapped as tools with auto-detected schemas.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';

// =============================================================================
// Types
// =============================================================================

/** Blast radius classification — determines permission requirements */
export type BlastRadius = 'read' | 'local' | 'shared' | 'destructive';

/** JSON Schema subset for tool parameters */
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  items?: ToolParameter; // for array type
  properties?: Record<string, ToolParameter>; // for object type
}

/** Tool definition — the standard interface for all capabilities */
export interface ToolDefinition {
  name: string;
  description: string;
  /** Parameter schema */
  parameters: Record<string, ToolParameter>;
  /** Which parameters are required */
  required?: string[];
  /** Blast radius determines auto-allow vs confirm */
  blastRadius: BlastRadius;
  /** Tags for capability routing */
  tags?: string[];
  /** Execution handler */
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

/** Standardized tool execution result */
export interface ToolResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

/** Tool execution event for structured logging */
export interface ToolEvent {
  id: string;
  toolName: string;
  phase: 'pre' | 'post';
  params?: Record<string, unknown>;
  result?: ToolResult;
  timestamp: string;
}

// =============================================================================
// Registry
// =============================================================================

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private eventCounter = 0;

  /** Register a tool definition */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      slog('TOOL-REGISTRY', `Overwriting tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Unregister a tool */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Get a tool by name */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** List all registered tools */
  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** List tools by tag */
  listByTag(tag: string): ToolDefinition[] {
    return this.list().filter(t => t.tags?.includes(tag));
  }

  /** List tools by blast radius */
  listByBlastRadius(radius: BlastRadius): ToolDefinition[] {
    return this.list().filter(t => t.blastRadius === radius);
  }

  /** Validate parameters against tool schema */
  validate(toolName: string, params: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const tool = this.tools.get(toolName);
    if (!tool) return { valid: false, errors: [`Tool not found: ${toolName}`] };

    const errors: string[] = [];

    // Check required parameters
    for (const req of tool.required ?? []) {
      if (params[req] === undefined || params[req] === null) {
        errors.push(`Missing required parameter: ${req}`);
      }
    }

    // Type checking
    for (const [key, value] of Object.entries(params)) {
      const schema = tool.parameters[key];
      if (!schema) continue; // Allow extra params (flexible)

      if (value !== undefined && value !== null) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== schema.type) {
          errors.push(`Parameter ${key}: expected ${schema.type}, got ${actualType}`);
        }
        // Enum check
        if (schema.enum && !schema.enum.includes(value)) {
          errors.push(`Parameter ${key}: must be one of ${schema.enum.join(', ')}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Execute a tool with validation and structured logging */
  async execute(toolName: string, params: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool not found: ${toolName}`,
        durationMs: 0,
      };
    }

    // Validate
    const validation = this.validate(toolName, params);
    if (!validation.valid) {
      return {
        success: false,
        output: '',
        error: `Validation failed: ${validation.errors.join('; ')}`,
        durationMs: 0,
      };
    }

    // Generate event ID
    const eventId = `tool_${Date.now()}_${++this.eventCounter}`;

    // Pre-event
    eventBus.emit('action:tool', {
      id: eventId,
      toolName,
      phase: 'pre',
      params: summarizeParams(params),
    });

    const startMs = Date.now();
    let result: ToolResult;

    try {
      result = await tool.execute(params);
    } catch (err) {
      result = {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      };
    }

    result.durationMs = Date.now() - startMs;

    // Post-event
    eventBus.emit('action:tool', {
      id: eventId,
      toolName,
      phase: 'post',
      result: {
        success: result.success,
        outputLength: result.output.length,
        error: result.error,
        durationMs: result.durationMs,
      },
    });

    return result;
  }

  /** Get tool schemas for LLM context injection */
  getSchemas(filter?: { tags?: string[]; blastRadius?: BlastRadius[] }): ToolSchema[] {
    let tools = this.list();

    if (filter?.tags) {
      tools = tools.filter(t => t.tags?.some(tag => filter.tags!.includes(tag)));
    }
    if (filter?.blastRadius) {
      tools = tools.filter(t => filter.blastRadius!.includes(t.blastRadius));
    }

    return tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      required: t.required,
      blastRadius: t.blastRadius,
    }));
  }

  /** Get count */
  get size(): number {
    return this.tools.size;
  }
}

/** Schema-only view (no execute function) for LLM injection */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  required?: string[];
  blastRadius: BlastRadius;
}

// Singleton
export const toolRegistry = new ToolRegistry();

// =============================================================================
// Shell Script → Tool Adapter
// =============================================================================

/**
 * Wrap a shell script as a standard tool.
 * Maintains backward compatibility with existing perception plugins.
 */
export function registerShellTool(opts: {
  name: string;
  description: string;
  script: string;
  cwd?: string;
  timeout?: number;
  blastRadius?: BlastRadius;
  tags?: string[];
  parameters?: Record<string, ToolParameter>;
}): void {
  const timeout = opts.timeout ?? 10000;
  const scriptPath = path.isAbsolute(opts.script)
    ? opts.script
    : path.resolve(opts.cwd ?? process.cwd(), opts.script);

  toolRegistry.register({
    name: opts.name,
    description: opts.description,
    parameters: opts.parameters ?? {},
    blastRadius: opts.blastRadius ?? 'read',
    tags: opts.tags ?? ['perception'],
    execute: async (params) => {
      const startMs = Date.now();

      if (!fs.existsSync(scriptPath)) {
        return {
          success: false,
          output: '',
          error: `Script not found: ${scriptPath}`,
          durationMs: Date.now() - startMs,
        };
      }

      try {
        const args = params.args ? (Array.isArray(params.args) ? params.args as string[] : [String(params.args)]) : [];
        const output = await new Promise<string>((resolve, reject) => {
          execFile(
            scriptPath,
            args,
            {
              encoding: 'utf-8',
              timeout,
              cwd: opts.cwd ?? process.cwd(),
              maxBuffer: 1024 * 1024,
              env: {
                ...process.env,
                ...Object.fromEntries(
                  Object.entries(params).filter(([k]) => k !== 'args').map(([k, v]) => [`TOOL_${k.toUpperCase()}`, String(v)])
                ),
              },
            },
            (error, stdout, stderr) => {
              if (error) reject(Object.assign(error, { stderr }));
              else resolve(stdout);
            },
          );
        });

        return {
          success: true,
          output: output.trim(),
          durationMs: Date.now() - startMs,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: '',
          error: msg.split('\n')[0].slice(0, 200),
          durationMs: Date.now() - startMs,
        };
      }
    },
  });
}

// =============================================================================
// Built-in Tools
// =============================================================================

/** Register core built-in tools */
export function registerBuiltinTools(): void {
  // File Read
  toolRegistry.register({
    name: 'read',
    description: 'Read a file from the filesystem',
    parameters: {
      path: { type: 'string', description: 'Absolute file path to read', required: true },
      offset: { type: 'number', description: 'Line number to start reading from' },
      limit: { type: 'number', description: 'Number of lines to read' },
    },
    required: ['path'],
    blastRadius: 'read',
    tags: ['filesystem', 'core'],
    execute: async (params) => {
      const startMs = Date.now();
      const filePath = String(params.path);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const offset = (params.offset as number) ?? 0;
        const limit = (params.limit as number) ?? lines.length;
        const slice = lines.slice(offset, offset + limit);
        return {
          success: true,
          output: slice.map((l, i) => `${offset + i + 1}\t${l}`).join('\n'),
          data: { totalLines: lines.length, readLines: slice.length },
          durationMs: Date.now() - startMs,
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startMs,
        };
      }
    },
  });

  // File Write
  toolRegistry.register({
    name: 'write',
    description: 'Write content to a file (creates or overwrites)',
    parameters: {
      path: { type: 'string', description: 'Absolute file path to write', required: true },
      content: { type: 'string', description: 'Content to write', required: true },
    },
    required: ['path', 'content'],
    blastRadius: 'local',
    tags: ['filesystem', 'core'],
    execute: async (params) => {
      const startMs = Date.now();
      const filePath = String(params.path);
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, String(params.content), 'utf-8');
        return {
          success: true,
          output: `Written ${String(params.content).length} chars to ${filePath}`,
          durationMs: Date.now() - startMs,
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startMs,
        };
      }
    },
  });

  // Glob Search
  toolRegistry.register({
    name: 'glob',
    description: 'Find files matching a glob pattern',
    parameters: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts")', required: true },
      cwd: { type: 'string', description: 'Directory to search in' },
    },
    required: ['pattern'],
    blastRadius: 'read',
    tags: ['filesystem', 'search', 'core'],
    execute: async (params) => {
      const startMs = Date.now();
      try {
        const { execSync } = await import('node:child_process');
        const cwd = params.cwd ? String(params.cwd) : process.cwd();
        const output = execSync(`find . -path './${String(params.pattern)}' -type f 2>/dev/null | head -200`, {
          cwd, encoding: 'utf-8', timeout: 10000,
        });
        const files = output.trim().split('\n').filter(Boolean);
        return {
          success: true,
          output: files.join('\n'),
          data: { count: files.length },
          durationMs: Date.now() - startMs,
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startMs,
        };
      }
    },
  });

  // Grep Search
  toolRegistry.register({
    name: 'grep',
    description: 'Search file contents with regex pattern',
    parameters: {
      pattern: { type: 'string', description: 'Regex pattern to search for', required: true },
      path: { type: 'string', description: 'Directory or file to search in' },
      glob: { type: 'string', description: 'File glob filter (e.g. "*.ts")' },
      maxResults: { type: 'number', description: 'Max results to return (default: 50)' },
    },
    required: ['pattern'],
    blastRadius: 'read',
    tags: ['search', 'core'],
    execute: async (params) => {
      const startMs = Date.now();
      try {
        const args = ['--color=never', '-n', '-r'];
        if (params.glob) args.push('--include', String(params.glob));
        const maxResults = (params.maxResults as number) ?? 50;
        args.push('-m', String(maxResults));
        args.push(String(params.pattern));
        args.push(params.path ? String(params.path) : '.');

        const output = await new Promise<string>((resolve, reject) => {
          execFile('grep', args, {
            encoding: 'utf-8',
            timeout: 10000,
            maxBuffer: 1024 * 1024,
          }, (error, stdout) => {
            // grep returns exit 1 for no matches — that's OK
            if (error && (error as NodeJS.ErrnoException).code !== '1' && !stdout) {
              reject(error);
            } else {
              resolve(stdout);
            }
          });
        });

        const lines = output.trim().split('\n').filter(Boolean);
        return {
          success: true,
          output: output.trim(),
          data: { matchCount: lines.length },
          durationMs: Date.now() - startMs,
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startMs,
        };
      }
    },
  });

  // Bash Execute
  toolRegistry.register({
    name: 'bash',
    description: 'Execute a shell command',
    parameters: {
      command: { type: 'string', description: 'Shell command to execute', required: true },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
    },
    required: ['command'],
    blastRadius: 'local', // Elevated to 'shared' or 'destructive' by blast-radius classifier
    tags: ['shell', 'core'],
    execute: async (params) => {
      const startMs = Date.now();
      const timeout = (params.timeout as number) ?? 30000;
      try {
        const { execSync } = await import('node:child_process');
        const output = execSync(String(params.command), {
          encoding: 'utf-8',
          timeout,
          cwd: params.cwd ? String(params.cwd) : process.cwd(),
          maxBuffer: 2 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return {
          success: true,
          output: output.trim(),
          durationMs: Date.now() - startMs,
        };
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; status?: number };
        return {
          success: false,
          output: execErr.stdout?.trim() ?? '',
          error: execErr.stderr?.trim().slice(0, 500) ?? (err instanceof Error ? err.message : String(err)),
          data: { exitCode: execErr.status },
          durationMs: Date.now() - startMs,
        };
      }
    },
  });

  // Web Fetch
  toolRegistry.register({
    name: 'web-fetch',
    description: 'Fetch content from a URL',
    parameters: {
      url: { type: 'string', description: 'URL to fetch', required: true },
      method: { type: 'string', description: 'HTTP method', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
      headers: { type: 'object', description: 'Request headers' },
      body: { type: 'string', description: 'Request body' },
    },
    required: ['url'],
    blastRadius: 'shared',
    tags: ['web', 'core'],
    execute: async (params) => {
      const startMs = Date.now();
      try {
        const resp = await fetch(String(params.url), {
          method: (params.method as string) ?? 'GET',
          headers: params.headers as Record<string, string> | undefined,
          body: params.body ? String(params.body) : undefined,
          signal: AbortSignal.timeout(30000),
        });
        const text = await resp.text();
        return {
          success: resp.ok,
          output: text.slice(0, 50000), // 50KB cap
          data: { status: resp.status, contentType: resp.headers.get('content-type') },
          error: resp.ok ? undefined : `HTTP ${resp.status}`,
          durationMs: Date.now() - startMs,
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startMs,
        };
      }
    },
  });

  slog('TOOL-REGISTRY', `Registered ${toolRegistry.size} built-in tools`);
}

// =============================================================================
// Helpers
// =============================================================================

/** Summarize params for logging (truncate large values) */
function summarizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v.length > 200) {
      summary[k] = v.slice(0, 200) + '...';
    } else {
      summary[k] = v;
    }
  }
  return summary;
}

/**
 * Format tool schemas for LLM system prompt injection.
 * Compact format similar to Claude Code's tool descriptions.
 */
export function formatToolSchemasForPrompt(schemas: ToolSchema[]): string {
  if (schemas.length === 0) return '';

  const lines = schemas.map(s => {
    const params = Object.entries(s.parameters)
      .map(([k, v]) => `  - ${k} (${v.type}${v.required ? ', required' : ''}): ${v.description}`)
      .join('\n');
    return `### ${s.name} [${s.blastRadius}]\n${s.description}\n${params}`;
  });

  return `## Available Tools\n\n${lines.join('\n\n')}`;
}
