#!/usr/bin/env npx tsx
/**
 * oMLX Model Benchmark — 使用 Qwen 官方推薦參數測試
 *
 * 參數來源：
 *   - 0.8B: https://huggingface.co/Qwen/Qwen3.5-0.8B
 *   - 9B:   https://huggingface.co/Qwen/Qwen3.5-9B
 *
 * Usage: npx tsx tests/omlx-benchmark.ts
 */

const LLM_URL = process.env.LOCAL_LLM_URL ?? 'http://localhost:8000';

// ─── Official Recommended Profiles ──────────────────────────────────────────
// Source: Qwen HuggingFace model cards

interface ProfileConfig {
  label: string;
  model: string;
  temperature: number;
  top_p: number;
  top_k: number;
  presence_penalty: number;
  enable_thinking: boolean;
  max_tokens: number;       // 官方建議：standard=32768, complex=81920
}

const PROFILES: Record<string, ProfileConfig> = {
  '0.8B': {
    label: '0.8B (non-thinking text)',
    model: 'Qwen3.5-0.8B-MLX-4bit',
    temperature: 1.0,
    top_p: 1.0,
    top_k: 20,
    presence_penalty: 2.0,
    enable_thinking: false,
    max_tokens: 32768,
  },
  '9B': {
    label: '9B (non-thinking general)',
    model: 'Qwen3.5-9B-MLX-4bit',
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    presence_penalty: 1.5,
    enable_thinking: false,
    max_tokens: 32768,
  },
  '9B-reasoning': {
    label: '9B (non-thinking reasoning)',
    model: 'Qwen3.5-9B-MLX-4bit',
    temperature: 1.0,
    top_p: 1.0,
    top_k: 40,
    presence_penalty: 2.0,
    enable_thinking: false,
    max_tokens: 81920,
  },
  '9B-thinking': {
    label: '9B (thinking general)',
    model: 'Qwen3.5-9B-MLX-4bit',
    temperature: 1.0,
    top_p: 0.95,
    top_k: 20,
    presence_penalty: 1.5,
    enable_thinking: true,
    max_tokens: 81920,
  },
};

// ─── Test Scenarios ──────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  category: string;
  prompt: string;
  /** Which profiles to test this scenario with */
  profiles: string[];
  expectedMinLength: number;
  tools?: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: '簡單問答',
    category: '日常',
    prompt: 'What is 2+2? Reply with just the number.',
    profiles: ['0.8B', '9B'],
    expectedMinLength: 1,
  },
  {
    name: '分類/路由',
    category: '日常',
    prompt: 'Classify this text into one category (coding/chat/reasoning/creative): "Help me write a Python function to sort a list". Reply with one word only.',
    profiles: ['0.8B', '9B'],
    expectedMinLength: 3,
  },
  {
    name: '翻譯',
    category: '日常',
    prompt: 'Translate to Traditional Chinese: "The quick brown fox jumps over the lazy dog"',
    profiles: ['0.8B', '9B'],
    expectedMinLength: 5,
  },
  {
    name: '摘要',
    category: '中等',
    prompt: `Summarize this in 2 sentences: "Artificial intelligence has transformed many industries including healthcare, where it helps diagnose diseases earlier, finance, where it detects fraud in real-time, and transportation, where it powers autonomous vehicles. However, experts warn about potential risks including job displacement, privacy concerns, and the need for robust regulatory frameworks to ensure AI development benefits humanity while minimizing harmful impacts. Researchers at leading universities and tech companies are working together to develop ethical guidelines and safety measures that could help navigate these challenges while maximizing the technology benefits."`,
    profiles: ['0.8B', '9B'],
    expectedMinLength: 30,
  },
  {
    name: '程式碼生成',
    category: '中等',
    prompt: 'Write a TypeScript function called `fibonacci` that returns the nth fibonacci number using memoization. Include the type signature. Code only, no explanation.',
    profiles: ['0.8B', '9B'],
    expectedMinLength: 50,
  },
  {
    name: '創意寫作',
    category: '中等',
    prompt: 'Write a haiku about programming in the rain.',
    profiles: ['0.8B', '9B'],
    expectedMinLength: 10,
  },
  {
    name: '邏輯推理',
    category: '推理',
    prompt: 'A farmer has a fox, a chicken, and a bag of grain. He needs to cross a river in a boat that can only carry him and one item. The fox will eat the chicken if left alone, and the chicken will eat the grain if left alone. How does he get everything across? Explain step by step.',
    profiles: ['0.8B', '9B', '9B-reasoning', '9B-thinking'],
    expectedMinLength: 100,
  },
  {
    name: '數學推理',
    category: '推理',
    prompt: 'If a train travels at 60 km/h for 2.5 hours, then at 80 km/h for 1.5 hours, what is the average speed for the entire journey? Show your work.',
    profiles: ['0.8B', '9B', '9B-reasoning', '9B-thinking'],
    expectedMinLength: 50,
  },
  {
    name: '閱讀理解',
    category: '長文',
    prompt: `Read the following conversation and answer the questions.

Alice: "I think we should use PostgreSQL for the new project."
Bob: "But we discussed using MongoDB last week because of the flexible schema."
Alice: "True, but after researching more, PostgreSQL with JSONB gives us both structured and flexible options. Plus we need ACID compliance for the payment system."
Bob: "Good point about payments. What about the real-time features?"
Alice: "We can add Redis for caching and pub/sub. The PostgreSQL + Redis combo is battle-tested."
Bob: "Alright, I'm convinced. I'll set up the CI/CD pipeline with the new stack."
Alice: "Great, I'll draft the schema this week."

Questions:
1. What database did they finally choose?
2. What was Bob's initial preference?
3. What will Alice do next?`,
    profiles: ['0.8B', '9B'],
    expectedMinLength: 50,
  },
  {
    name: 'Tool Calling',
    category: '工具',
    prompt: 'Search memory for "TypeScript configuration"',
    profiles: ['9B'],
    expectedMinLength: 0,
    tools: true,
  },
];

// ─── Benchmark Runner ────────────────────────────────────────────────────────

interface BenchmarkResult {
  profile: string;
  model: string;
  scenario: string;
  category: string;
  success: boolean;
  prefillMs: number;
  totalMs: number;
  tokensGenerated: number;
  tokensPerSec: number;
  responseLength: number;
  responsePreview: string;
  hasReasoningContent: boolean;
  reasoningLength: number;
  finishReason: string;
  error?: string;
  hasToolCalls?: boolean;
  // Profile params used
  params: { temperature: number; top_p: number; top_k: number; presence_penalty: number; max_tokens: number; enable_thinking: boolean };
}

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_memory',
      description: 'Search agent memory',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
];

async function runBenchmark(profileKey: string, profile: ProfileConfig, scenario: Scenario): Promise<BenchmarkResult> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: scenario.prompt },
  ];

  const body: Record<string, unknown> = {
    model: profile.model,
    messages,
    max_tokens: profile.max_tokens,
    temperature: profile.temperature,
    top_p: profile.top_p,
    top_k: profile.top_k,
    presence_penalty: profile.presence_penalty,
    stream: true,
    chat_template_kwargs: { enable_thinking: profile.enable_thinking },
  };
  if (scenario.tools) {
    body.tools = TOOLS;
  }

  const startTime = performance.now();
  let firstTokenTime = 0;
  let content = '';
  let reasoningContent = '';
  let tokensGenerated = 0;
  let hasToolCalls = false;
  let finishReason = '';

  try {
    const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        profile: profileKey, model: profile.model, scenario: scenario.name, category: scenario.category,
        success: false, prefillMs: 0, totalMs: 0, tokensGenerated: 0,
        tokensPerSec: 0, responseLength: 0, responsePreview: '',
        hasReasoningContent: false, reasoningLength: 0, finishReason: '',
        error: `HTTP ${res.status}: ${errText.slice(0, 100)}`,
        params: { temperature: profile.temperature, top_p: profile.top_p, top_k: profile.top_k, presence_penalty: profile.presence_penalty, max_tokens: profile.max_tokens, enable_thinking: profile.enable_thinking },
      };
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            if (!firstTokenTime) firstTokenTime = performance.now();
            content += delta.content;
            tokensGenerated++;
          }
          if (delta?.reasoning_content) {
            if (!firstTokenTime) firstTokenTime = performance.now();
            reasoningContent += delta.reasoning_content;
            tokensGenerated++;
          }
          if (delta?.tool_calls) {
            if (!firstTokenTime) firstTokenTime = performance.now();
            hasToolCalls = true;
            tokensGenerated++;
          }
          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
          if (chunk.usage?.completion_tokens) {
            tokensGenerated = chunk.usage.completion_tokens;
          }
        } catch { /* keep-alive or malformed */ }
      }
    }

    const totalMs = performance.now() - startTime;
    const prefillMs = firstTokenTime ? firstTokenTime - startTime : totalMs;
    const tokensPerSec = tokensGenerated > 0 ? (tokensGenerated / (totalMs / 1000)) : 0;

    return {
      profile: profileKey,
      model: profile.model,
      scenario: scenario.name,
      category: scenario.category,
      success: content.length >= scenario.expectedMinLength || hasToolCalls,
      prefillMs: Math.round(prefillMs),
      totalMs: Math.round(totalMs),
      tokensGenerated,
      tokensPerSec: Math.round(tokensPerSec * 10) / 10,
      responseLength: content.length,
      responsePreview: content.replace(/\n/g, ' ').slice(0, 100),
      hasReasoningContent: reasoningContent.length > 0,
      reasoningLength: reasoningContent.length,
      finishReason,
      hasToolCalls,
      params: { temperature: profile.temperature, top_p: profile.top_p, top_k: profile.top_k, presence_penalty: profile.presence_penalty, max_tokens: profile.max_tokens, enable_thinking: profile.enable_thinking },
    };
  } catch (e) {
    const totalMs = performance.now() - startTime;
    return {
      profile: profileKey, model: profile.model, scenario: scenario.name, category: scenario.category,
      success: false, prefillMs: 0, totalMs: Math.round(totalMs),
      tokensGenerated: 0, tokensPerSec: 0, responseLength: 0,
      responsePreview: '', hasReasoningContent: false, reasoningLength: 0,
      finishReason: '', error: (e as Error).message.slice(0, 80),
      params: { temperature: profile.temperature, top_p: profile.top_p, top_k: profile.top_k, presence_penalty: profile.presence_penalty, max_tokens: profile.max_tokens, enable_thinking: profile.enable_thinking },
    };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

async function main() {
  // Verify oMLX is running
  console.log('🔍 檢查 oMLX...\n');
  const modelsRes = await fetch(`${LLM_URL}/v1/models`);
  const modelsData = await modelsRes.json() as { data: Array<{ id: string }> };
  const availableModels = modelsData.data.map(m => m.id);
  console.log(`📦 可用模型：${availableModels.join(', ')}\n`);

  console.log('📋 測試 Profiles（Qwen 官方推薦參數）：');
  for (const [key, p] of Object.entries(PROFILES)) {
    console.log(`   ${pad(key, 16)} temp=${p.temperature} top_p=${p.top_p} top_k=${p.top_k} pp=${p.presence_penalty} think=${p.enable_thinking} max=${p.max_tokens}`);
  }
  console.log();

  // Warmup: send a trivial request to each model to avoid cold-start bias
  console.log('🔥 暖機中...');
  const seenModels = new Set<string>();
  for (const p of Object.values(PROFILES)) {
    if (seenModels.has(p.model)) continue;
    seenModels.add(p.model);
    process.stdout.write(`   ${p.model} ... `);
    try {
      const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: p.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 4,
          temperature: 0.1,
          stream: false,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) console.log('ready');
      else console.log(`HTTP ${res.status}`);
    } catch (e) {
      console.log(`error: ${(e as Error).message.slice(0, 40)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log();

  const results: BenchmarkResult[] = [];
  let testNum = 0;
  const totalTests = SCENARIOS.reduce((sum, s) => sum + s.profiles.length, 0);

  for (const scenario of SCENARIOS) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📝 ${scenario.name}（${scenario.category}）`);
    console.log('═'.repeat(70));

    for (const profileKey of scenario.profiles) {
      testNum++;
      const profile = PROFILES[profileKey];
      if (!profile) {
        console.log(`  ⚠️  Profile ${profileKey} not found, skipping`);
        continue;
      }
      if (!availableModels.includes(profile.model)) {
        console.log(`  ⚠️  Model ${profile.model} not available, skipping`);
        continue;
      }

      process.stdout.write(`  [${testNum}/${totalTests}] ${pad(profileKey, 16)} ... `);

      const result = await runBenchmark(profileKey, profile, scenario);
      results.push(result);

      const status = result.success ? '✅' : '❌';
      const thinkInfo = result.hasReasoningContent ? ` 💭${result.reasoningLength}c` : '';
      console.log(
        `${status} ${formatMs(result.prefillMs)} → ${formatMs(result.totalMs)} | ${result.tokensGenerated} tok | ${result.tokensPerSec} tok/s | ${result.finishReason}${thinkInfo}`
      );
      if (result.responsePreview) {
        console.log(`     → ${result.responsePreview}`);
      }
      if (result.error) {
        console.log(`     ❌ ${result.error}`);
      }

      await new Promise(r => setTimeout(r, 500));
    }
  }

  // ─── Summary Table ───────────────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(90)}`);
  console.log('📊 速度對比表');
  console.log('═'.repeat(90));
  console.log(`\n${pad('場景', 14)} ${pad('Profile', 16)} ${pad('Prefill', 10)} ${pad('Total', 10)} ${pad('Tokens', 8)} ${pad('tok/s', 8)} ${pad('Finish', 8)} Think?`);
  console.log('─'.repeat(90));

  for (const scenario of SCENARIOS) {
    for (const profileKey of scenario.profiles) {
      const r = results.find(x => x.scenario === scenario.name && x.profile === profileKey);
      if (!r) continue;
      const think = r.hasReasoningContent ? `💭 ${r.reasoningLength}c` : '—';
      console.log(
        `${pad(r.scenario, 14)} ${pad(profileKey, 16)} ${pad(formatMs(r.prefillMs), 10)} ${pad(formatMs(r.totalMs), 10)} ${pad(String(r.tokensGenerated), 8)} ${pad(String(r.tokensPerSec), 8)} ${pad(r.finishReason, 8)} ${think}`
      );
    }
  }

  // ─── Profile Summary ─────────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(90)}`);
  console.log('📈 各 Profile 總結');
  console.log('═'.repeat(90));

  for (const [key, profile] of Object.entries(PROFILES)) {
    const profileResults = results.filter(r => r.profile === key);
    if (profileResults.length === 0) continue;
    const successCount = profileResults.filter(r => r.success).length;
    const speedResults = profileResults.filter(r => r.tokensPerSec > 0);
    const avgTokPerSec = speedResults.length > 0
      ? speedResults.reduce((sum, r) => sum + r.tokensPerSec, 0) / speedResults.length
      : 0;
    const avgPrefill = speedResults.length > 0
      ? speedResults.reduce((sum, r) => sum + r.prefillMs, 0) / speedResults.length
      : 0;

    console.log(`\n  ${key} — ${profile.label}`);
    console.log(`     成功率：${successCount}/${profileResults.length}`);
    console.log(`     平均速度：${Math.round(avgTokPerSec * 10) / 10} tok/s`);
    console.log(`     平均 Prefill：${formatMs(Math.round(avgPrefill))}`);
    console.log(`     參數：temp=${profile.temperature} top_p=${profile.top_p} top_k=${profile.top_k} pp=${profile.presence_penalty} think=${profile.enable_thinking} max=${profile.max_tokens}`);
  }

  // ─── Save Results ─────────────────────────────────────────────────

  const outputPath = `${process.cwd()}/tests/benchmark-results-${new Date().toISOString().slice(0, 10)}.json`;
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify({
    date: new Date().toISOString(),
    profiles: PROFILES,
    results,
  }, null, 2));
  console.log(`\n\n💾 完整結果已存至：${outputPath}`);
  console.log('\n✅ Benchmark 完成\n');
}

main().catch(e => {
  console.error('❌ Benchmark 失敗:', e);
  process.exit(1);
});
