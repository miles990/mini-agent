#!/usr/bin/env node
/**
 * Thin local LLM delegate — reads prompt from stdin, calls oMLX/OpenAI-compatible API, writes result to stdout.
 * Used by delegation.ts for provider='local' tasks.
 */
import { readFileSync } from 'fs';

const prompt = readFileSync('/dev/stdin', 'utf-8');
const baseUrl = process.env.LOCAL_LLM_URL || 'http://localhost:8000';
const apiKey = process.env.LOCAL_LLM_KEY || 'local';

const profileName = process.env.LOCAL_LLM_PROFILE || 'default';
let profileParams = {};
try {
  const profilePath = new URL(`../llm/profiles/${profileName}.json`, import.meta.url);
  profileParams = JSON.parse(readFileSync(profilePath, 'utf-8'));
} catch { /* use defaults */ }

const body = {
  model: profileParams.model || process.env.LOCAL_LLM_MODEL || '',
  messages: [{ role: 'user', content: prompt }],
  max_tokens: profileParams.max_tokens || 8192,
  temperature: profileParams.temperature ?? 0.7,
  top_p: profileParams.top_p ?? 0.8,
  stream: false,
};
if (profileParams.top_k) body.top_k = profileParams.top_k;
if (profileParams.presence_penalty) body.presence_penalty = profileParams.presence_penalty;
if (profileParams.extra_body) Object.assign(body, profileParams.extra_body);

try {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    process.stderr.write(`Local LLM error: ${res.status} ${res.statusText}\n`);
    process.exit(1);
  }
  const data = await res.json();
  process.stdout.write(data.choices?.[0]?.message?.content ?? '');
} catch (err) {
  process.stderr.write(`Local LLM connection failed: ${err.message}\n`);
  process.exit(1);
}
