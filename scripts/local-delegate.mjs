#!/usr/bin/env node
/**
 * Thin local LLM delegate — reads prompt from stdin, calls oMLX/OpenAI-compatible API, writes result to stdout.
 * Used by delegation.ts for provider='local' tasks.
 */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

// Fetch via Chrome CDP (for sites requiring login: Facebook, LinkedIn, etc.)
function cdpFetch(url) {
  try {
    const scriptPath = new URL('./cdp-fetch.mjs', import.meta.url).pathname;
    const out = execFileSync('node', [scriptPath, 'fetch', url], { timeout: 20_000, encoding: 'utf-8' });
    // Extract content between "--- Content ---" and "--- Links ---"
    const contentMatch = out.match(/--- Content ---\n([\s\S]*?)(?=\n--- Links ---|$)/);
    return contentMatch ? contentMatch[1].trim().slice(0, 8000) : null;
  } catch { return null; }
}

// Sites that need CDP (login-walled)
const CDP_DOMAINS = ['facebook.com', 'linkedin.com', 'instagram.com'];

// Pre-fetch URLs found in prompt so the LLM has actual content to analyze
async function prefetchUrls(text) {
  const urlRe = /https?:\/\/[^\s)>"]+/g;
  const urls = [...new Set(text.match(urlRe) || [])];
  if (urls.length === 0) return text;

  const fetched = await Promise.allSettled(urls.map(async (url) => {
    try {
      // Convert GitHub repo URLs to raw README
      let fetchUrl = url;
      let isJson = false;
      const ghRepo = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/);
      if (ghRepo) fetchUrl = `https://raw.githubusercontent.com/${ghRepo[1]}/${ghRepo[2]}/main/README.md`;

      // X/Twitter → fxtwitter API for tweet content
      const xMatch = url.match(/^https:\/\/(?:x|twitter)\.com\/(\w+)\/status\/(\d+)/);
      if (xMatch) { fetchUrl = `https://api.fxtwitter.com/${xMatch[1]}/status/${xMatch[2]}`; isJson = true; }

      const res = await fetch(fetchUrl, {
        headers: { 'User-Agent': 'local-delegate/1.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;

      let content;
      if (isJson) {
        const data = await res.json();
        const t = data.tweet || {};
        content = `@${t.author?.screen_name}: ${t.text}\n\nLikes: ${t.likes} | RTs: ${t.retweets} | Replies: ${t.replies} | Date: ${t.created_at}`;
      } else {
        content = (await res.text()).slice(0, 8000);
      }
      return { url, content };
    } catch { return null; }
  }));

  let enriched = text;
  for (const r of fetched) {
    if (r.status === 'fulfilled' && r.value) {
      enriched += `\n\n<fetched-content url="${r.value.url}">\n${r.value.content}\n</fetched-content>`;
    }
  }
  return enriched;
}

let prompt = readFileSync('/dev/stdin', 'utf-8');
prompt = await prefetchUrls(prompt);
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
    signal: AbortSignal.timeout(600_000), // 10 min
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
