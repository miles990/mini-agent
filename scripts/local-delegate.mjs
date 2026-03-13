#!/usr/bin/env node
/**
 * Thin local LLM delegate — reads prompt from stdin, calls oMLX/OpenAI-compatible API, writes result to stdout.
 * Used by delegation.ts for provider='local' tasks.
 */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

// Fetch via Chrome CDP (for sites requiring login: Facebook, LinkedIn, etc.)
const LOGIN_SIGNALS = /sign\s*in|log\s*in|join now|create.*account|page.*not found|無法使用|isn't available|not been found|nicht gefunden|nenalezena|ikke fundet|no encontrada|trouvée|Hjælp|Help Center|help center|مركز المساعدة/i;
function cdpFetch(url) {
  try {
    const scriptPath = new URL('./cdp-fetch.mjs', import.meta.url).pathname;
    const out = execFileSync('node', [scriptPath, 'fetch', url], { timeout: 20_000, encoding: 'utf-8' });
    const contentMatch = out.match(/--- Content ---\n([\s\S]*?)(?=\n--- Links ---|$)/);
    const content = contentMatch ? contentMatch[1].trim().slice(0, 8000) : null;
    if (!content || content.length < 100 || LOGIN_SIGNALS.test(content)) return null;
    return content;
  } catch { return null; }
}

// Sites that need CDP (login-walled)
const CDP_DOMAINS = ['facebook.com', 'linkedin.com', 'instagram.com'];

// YouTube metadata via yt-dlp (title, description, uploader, views)
function ytdlpFetch(url) {
  try {
    const out = execFileSync('yt-dlp', ['--dump-json', '--no-download', url], { timeout: 20_000, encoding: 'utf-8' });
    const d = JSON.parse(out);
    return `Title: ${d.title}\nUploader: ${d.uploader}\nViews: ${d.view_count} | Likes: ${d.like_count} | Duration: ${d.duration_string}\nUpload date: ${d.upload_date}\n\nDescription:\n${(d.description || '').slice(0, 4000)}`;
  } catch { return null; }
}

// Reddit JSON API (append .json to URL)
async function redditFetch(url) {
  try {
    const jsonUrl = url.replace(/\/?$/, '.json');
    const res = await fetch(jsonUrl, {
      headers: { 'User-Agent': 'local-delegate/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const post = data[0]?.data?.children?.[0]?.data;
    if (!post) return null;
    let content = `Title: ${post.title}\nAuthor: u/${post.author}\nScore: ${post.score} | Comments: ${post.num_comments}\nSubreddit: r/${post.subreddit}\n\n${(post.selftext || '').slice(0, 3000)}`;
    // Top comments
    const comments = (data[1]?.data?.children || []).slice(0, 5);
    if (comments.length) {
      content += '\n\n--- Top Comments ---';
      for (const c of comments) {
        if (c.data?.body) content += `\n\nu/${c.data.author} (${c.data.score} pts):\n${c.data.body.slice(0, 500)}`;
      }
    }
    return content.slice(0, 8000);
  } catch { return null; }
}

// Pre-fetch URLs found in prompt so the LLM has actual content to analyze
async function prefetchUrls(text) {
  const urlRe = /https?:\/\/[^\s)>"]+/g;
  const urls = [...new Set(text.match(urlRe) || [])];
  if (urls.length === 0) return text;

  const results = [];
  const failed = [];

  const fetched = await Promise.allSettled(urls.map(async (url) => {
    try {
      // Login-walled sites → CDP fetch via Chrome session
      if (CDP_DOMAINS.some(d => url.includes(d))) {
        const content = cdpFetch(url);
        if (content) return { url, content };
        const domain = CDP_DOMAINS.find(d => url.includes(d));
        process.stderr.write(`[prefetch] CDP fetch failed for ${domain} — you may need to login first:\n  node scripts/cdp-fetch.mjs login https://${domain}\n`);
        return null;
      }

      // YouTube → yt-dlp metadata
      if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
        const content = ytdlpFetch(url);
        return content ? { url, content } : null;
      }

      // Reddit → JSON API
      if (url.includes('reddit.com/r/')) {
        const content = await redditFetch(url);
        return content ? { url, content } : null;
      }

      // Convert GitHub repo URLs to raw README (try main, fallback master)
      let fetchUrl = url;
      let isJson = false;
      const ghRepo = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/);
      if (ghRepo) {
        const base = `https://raw.githubusercontent.com/${ghRepo[1]}/${ghRepo[2]}`;
        const mainRes = await fetch(`${base}/main/README.md`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
        fetchUrl = mainRes?.ok ? `${base}/main/README.md` : `${base}/master/README.md`;
      }

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
  const loginNeeded = [];
  for (let i = 0; i < fetched.length; i++) {
    const r = fetched[i];
    if (r.status === 'fulfilled' && r.value) {
      enriched += `\n\n<fetched-content url="${r.value.url}">\n${r.value.content}\n</fetched-content>`;
    } else {
      const u = urls[i];
      if (CDP_DOMAINS.some(d => u.includes(d))) loginNeeded.push(u);
      else failed.push(u);
    }
  }
  // Anti-hallucination: tell the LLM which URLs could not be fetched
  if (failed.length || loginNeeded.length) {
    let msg = '\n\n<unfetched-urls>\nThe following URLs could not be retrieved. Do NOT fabricate or guess their content. If asked about them, state that you cannot access them.';
    if (loginNeeded.length) msg += `\n\nRequire login (user must authenticate in browser first):\n${loginNeeded.join('\n')}`;
    if (failed.length) msg += `\n\nFetch failed:\n${failed.join('\n')}`;
    enriched += msg + '\n</unfetched-urls>';
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
