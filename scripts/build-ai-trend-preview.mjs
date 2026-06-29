#!/usr/bin/env node
/**
 * build-ai-trend-preview.mjs (v2 — Alex 2026-05-07 12:04 feedback)
 *
 * 變動：
 *   - 卡片式 → 密集列表（更高資訊密度）
 *   - 每來源 updated_at 精準到分（Asia/Taipei）
 *   - 用 summary.claim / summary.so_what 當中文摘要（fallback story_text 截斷）
 *   - 每項保留「閱讀原文 →」明確 outbound 連結
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPO_STATE_DIR = join(ROOT, 'memory/state');
const MEMORY_ROOT = process.env.MINI_AGENT_MEMORY_DIR?.trim();
const STATE_DIR = MEMORY_ROOT ? join(MEMORY_ROOT, 'state') : REPO_STATE_DIR;
const READ_STATE_DIRS = Array.from(new Set([STATE_DIR, REPO_STATE_DIR]));
const OUT = join(ROOT, 'kuro-portfolio/ai-trend/preview.html');

function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
const DATE = process.argv[2] || todayTaipei();

function fmtTaipeiMinute(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d);
    const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}`;
  } catch { return '—'; }
}

function ageHours(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / 3600_000;
}

async function loadLatest(subdir, fromDate, days = 14, opts = {}) {
  const { keepX = false } = opts;
  const d = new Date(fromDate + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    try {
      const raw = JSON.parse(await readStateFile(subdir, `${key}.json`));
      const posts = (raw.posts || []).filter(p => {
        if (keepX) return true;
        const u = String(p.url || p.story_url || '').toLowerCase();
        return !/(^|\/\/)(www\.)?(x\.com|twitter\.com|t\.co)\//.test(u);
      });
      return { key, posts, run_at: raw.run_at, daysOld: i };
    } catch {}
  }
  return { key: null, posts: [], run_at: null, daysOld: null };
}

async function loadKuroPick(date) {
  const d = new Date(date + 'T00:00:00Z');
  for (let i = 0; i < 3; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    try {
      const md = await readStateFile('kuro-daily-pick', `${key}.md`);
      return { key, md };
    } catch {}
  }
  return { key: null, md: '' };
}

/**
 * loadKuroContent(date) — parse memory/state/kuro-content/<date>.md
 *
 * Returns { take, spotlight, swot }. Each field is the raw text of its H2
 * section, or null if the section / file is missing. Never throws.
 *
 * H2 matching is forgiving: accepts both canonical headings (## kuro-take,
 * ## github-spotlight, ## swot) and the numbered variants used in the seed
 * file (## ① Kuro take…, ## ⑤ 今日 GitHub 專案…, ## ④ SWOT…).
 */
async function loadKuroContent(date) {
  const empty = { take: null, spotlight: null, swot: null };
  try {
    const raw = await readStateFile('kuro-content', `${date}.md`);
    // Split on H2 boundaries; keep delimiter via lookahead-style split
    const sections = raw.split(/^(?=## )/m);
    const result = { take: null, spotlight: null, swot: null };
    for (const sec of sections) {
      const firstLine = sec.split('\n')[0] || '';
      const heading = firstLine.replace(/^##\s*/, '').toLowerCase();
      const body = sec.split('\n').slice(1).join('\n').trim();
      if (!body) continue;
      if (/kuro.?take|①/.test(heading)) {
        result.take = body;
      } else if (/github.?spotlight|⑤|github.*專案/.test(heading)) {
        result.spotlight = body;
      } else if (/^swot|④/.test(heading)) {
        result.swot = body;
      }
    }
    return result;
  } catch {
    return empty;
  }
}

function htmlEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function renderInlineLinks(s) {
  // Parse [text](url) markdown links inline; htmlEsc everything else.
  // Backward compatible: plain text renders identically to htmlEsc(s).
  const str = String(s ?? '');
  const parts = [];
  let last = 0;
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) parts.push(htmlEsc(str.slice(last, m.index)));
    const text = htmlEsc(m[1]);
    const url = htmlEsc(m[2]);
    parts.push(`<a href="${url}" target="_blank" rel="noopener">${text} ↗</a>`);
    last = m.index + m[0].length;
  }
  if (last < str.length) parts.push(htmlEsc(str.slice(last)));
  return parts.join('');
}
function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 10000) return (n/1000).toFixed(1) + 'k';
  return String(n);
}

// ── v3 kuro-content render functions ────────────────────────────────────────

/**
 * renderTake(take) — Block ① Kuro 點評
 * Converts raw paragraph text (from kuro-take section) into <section class="take">.
 * Each blank-line-separated paragraph becomes a <p>. Inline [text](url) links rendered.
 * If take is null, emits a placeholder banner.
 */
function renderTake(take, date) {
  if (!take) {
    return `<section class="take">
  <div class="kuro-block-label">① KURO 點評</div>
  <div class="kuro-placeholder">no kuro-content loaded for ${htmlEsc(date)}</div>
</section>`;
  }
  const paras = take.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const rendered = paras.map(p => {
    // Skip heading-like lines that may have leaked into body
    if (p.startsWith('#')) return '';
    // Convert **bold** to <b> for display
    const withBold = p.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return `<p>${renderInlineLinks(withBold)}</p>`;
  }).filter(Boolean).join('\n  ');
  return `<section class="take">
  <div class="kuro-block-label">① KURO 點評</div>
  ${rendered}
</section>`;
}

/**
 * renderTrendPlaceholder() — Block ② trend rise/fall (deferred to PR-B)
 * Always emits a static placeholder per the spec.
 */
function renderTrendPlaceholder() {
  return `<section class="trend">
  <div class="kuro-block-label">② 趨勢方向（rise / fall）</div>
  <div class="kuro-placeholder">待 PR-B 自動產出 — 目前由 trend-bars 區塊（7 日 HN 話題分布）代替</div>
</section>`;
}

/**
 * renderSpotlight(spotlight) — Block ③ GitHub 專案 spotlight
 * Parses key:value fields from the section body. Forgiving: unknown fields ignored.
 * If spotlight is null, emits a placeholder banner.
 */
function renderSpotlight(spotlight, date) {
  if (!spotlight) {
    return `<section class="spotlight">
  <div class="kuro-block-label">③ GITHUB SPOTLIGHT</div>
  <div class="kuro-placeholder">no kuro-content loaded for ${htmlEsc(date)}</div>
</section>`;
  }
  // Parse simple key: value fields and bullet lists
  const lines = spotlight.split('\n');
  const fields = {};
  let currentList = null;
  const lists = {};
  for (const line of lines) {
    // Skip H3 markers / horizontal rules
    if (/^#{1,6}\s/.test(line) || /^---+$/.test(line)) continue;
    const kvMatch = line.match(/^([a-zA-Z\-]+):\s*(.*)$/);
    if (kvMatch && !line.startsWith('- ')) {
      const key = kvMatch[1].toLowerCase();
      const val = kvMatch[2].trim();
      if (val) {
        fields[key] = val;
        currentList = null;
      } else {
        currentList = key;
        lists[key] = [];
      }
      continue;
    }
    if (line.match(/^\s*-\s+/) && currentList) {
      lists[currentList] = lists[currentList] || [];
      lists[currentList].push(line.replace(/^\s*-\s+/, '').trim());
      continue;
    }
    // Non-empty text lines (paragraphs) that aren't bullets
    if (line.trim() && !line.startsWith('- ') && !line.startsWith('`')) {
      currentList = null;
    }
  }

  const repo = fields['repo'] || '';
  const license = fields['license'] || '';
  const version = fields['version'] || '';
  const why = fields['why-it-matters'] || '';
  const goodBullets = (lists['why-good'] || []);
  const riskBullets = (lists['risk'] || []);
  const pathBullets = (lists['paths'] || []);

  const repoUrl = repo ? `https://github.com/${repo}` : '';
  const repoLink = repo
    ? `<a href="${htmlEsc(repoUrl)}" target="_blank" rel="noopener"><code>${htmlEsc(repo)}</code></a>`
    : '';

  const metaParts = [
    license ? `License: ${htmlEsc(license)}` : '',
    version ? `版本: ${htmlEsc(version)}` : '',
  ].filter(Boolean).join(' · ');

  return `<section class="spotlight">
  <div class="kuro-block-label">③ GITHUB SPOTLIGHT</div>
  <div class="spotlight-inner">
    ${repo ? `<h3 class="spotlight-repo">${repoLink}</h3>` : ''}
    ${metaParts ? `<div class="spotlight-meta">${metaParts}</div>` : ''}
    ${why ? `<p>${renderInlineLinks(why)}</p>` : ''}
    ${goodBullets.length ? `<div class="spotlight-sub">為什麼好</div><ul>${goodBullets.map(b => `<li>${renderInlineLinks(b)}</li>`).join('')}</ul>` : ''}
    ${riskBullets.length ? `<div class="spotlight-sub">風險</div><ul>${riskBullets.map(b => `<li>${renderInlineLinks(b)}</li>`).join('')}</ul>` : ''}
    ${pathBullets.length ? `<div class="spotlight-sub">整合路徑</div><ul>${pathBullets.map(b => `<li>${renderInlineLinks(b)}</li>`).join('')}</ul>` : ''}
  </div>
</section>`;
}

/**
 * renderSwot(swot) — Block ④ SWOT
 * Parses strengths / weaknesses / opportunities / threats bullet lists.
 * Also handles markdown table format (| S | content |) used in seed file.
 * If swot is null, emits a placeholder banner.
 */
function renderSwot(swot, date) {
  if (!swot) {
    return `<section class="swot">
  <div class="kuro-block-label">④ SWOT</div>
  <div class="kuro-placeholder">no kuro-content loaded for ${htmlEsc(date)}</div>
</section>`;
  }

  // Try to parse as markdown table (| 維度 | 內容 | format used in seed)
  const tableMap = {};
  const tableRe = /^\|\s*\*{0,2}([SWOT][^|]*?)\*{0,2}\s*\|\s*(.+?)\s*\|?\s*$/;
  for (const line of swot.split('\n')) {
    const m = line.match(tableRe);
    if (m) {
      const key = m[1].trim().slice(0, 1).toLowerCase(); // S/W/O/T → s/w/o/t
      tableMap[key] = (tableMap[key] || '') + ' ' + m[2].trim();
    }
  }

  // Try bullet-list format (strengths: / weaknesses: / opportunities: / threats:)
  const lists = {};
  let currentKey = null;
  const keyMap = {
    strengths: 's', weaknesses: 'w', opportunities: 'o', threats: 't'
  };
  for (const line of swot.split('\n')) {
    const kvMatch = line.match(/^([a-zA-Z]+):\s*$/);
    if (kvMatch && keyMap[kvMatch[1].toLowerCase()]) {
      currentKey = keyMap[kvMatch[1].toLowerCase()];
      lists[currentKey] = [];
      continue;
    }
    if (line.match(/^\s*-\s+/) && currentKey) {
      lists[currentKey] = lists[currentKey] || [];
      lists[currentKey].push(line.replace(/^\s*-\s+/, '').trim());
    }
  }

  const dims = [
    { key: 's', label: 'S 優勢' },
    { key: 'w', label: 'W 弱點' },
    { key: 'o', label: 'O 機會' },
    { key: 't', label: 'T 威脅' },
  ];

  const cells = dims.map(({ key, label }) => {
    const bullets = lists[key];
    const tableText = tableMap[key];
    if (bullets && bullets.length) {
      return `<div class="swot-cell">
      <b>${htmlEsc(label)}</b>
      <ul>${bullets.map(b => `<li>${renderInlineLinks(b)}</li>`).join('')}</ul>
    </div>`;
    } else if (tableText) {
      // Split table text on numbered items or semicolons
      const items = tableText.split(/；|;\s*\(\d+\)|\s*\(\d+\)/).map(s => s.trim()).filter(Boolean);
      return `<div class="swot-cell">
      <b>${htmlEsc(label)}</b>
      <ul>${items.map(b => `<li>${renderInlineLinks(b)}</li>`).join('')}</ul>
    </div>`;
    }
    return `<div class="swot-cell"><b>${htmlEsc(label)}</b></div>`;
  }).join('\n  ');

  return `<section class="swot">
  <div class="kuro-block-label">④ SWOT</div>
  <div class="swot-grid">
  ${cells}
  </div>
</section>`;
}

const SRC_ZH = { WEB: '網頁', HN: 'HN', LATENT: 'Latent', ARXIV: 'arXiv', GITHUB: 'GitHub', X: 'X' };
function tagOf(post) {
  const t = (post.title + ' ' + (post.story_text || '')).toLowerCase();
  if (/\b(agent|mcp|tool[- ]use|orchestrat)\b/.test(t)) return '代理';
  if (/\b(gpt[- ]?\d|claude|gemini|llama|mistral|sonnet|opus)\b/.test(t)) return '模型';
  if (/\b(rag|retriev|embed|vector|memory)\b/.test(t)) return '記憶';
  if (/\b(eval|benchmark|leaderboard|swe[- ]bench)\b/.test(t)) return '評測';
  if (/\b(security|injection|jailbreak|exploit|cve)\b/.test(t)) return '安全';
  if (/\b(train|fine[- ]?tun|rlhf|distill|sft|dpo)\b/.test(t)) return '訓練';
  if (/\b(infra|gpu|cuda|inference|vllm|kubernetes)\b/.test(t)) return '基礎設施';
  return '其他';
}
function uniqByUrl(posts) {
  const seen = new Set();
  return posts.filter(p => {
    const key = (p.url || p.id || p.title || '').replace(/[?#].*$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadTopicTrend(fromDate) {
  // Load 14 days; first 7 = current window, days 7-13 = prior baseline for ▲▼
  const d = new Date(fromDate + 'T00:00:00Z');
  const counts = {};
  const prevCounts = {};
  for (let i = 0; i < 14; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    try {
      const raw = JSON.parse(await readStateFile('hn-ai-trend', `${key}.json`));
      const target = i < 7 ? counts : prevCounts;
      for (const p of (raw.posts || [])) {
        const t = tagOf(p);
        target[t] = (target[t] || 0) + 1;
      }
    } catch {}
  }
  return { counts, prevCounts };
}

async function readStateFile(...segments) {
  let lastError;
  for (const stateDir of READ_STATE_DIRS) {
    try {
      return await readFile(join(stateDir, ...segments), 'utf8');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`state file not found: ${segments.join('/')}`);
}

async function listArchiveDates() {
  try {
    const files = await readdir(join(ROOT, 'kuro-portfolio/ai-trend'));
    return files.filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
      .map(f => f.replace('.html',''))
      .sort().reverse().slice(0, 60);
  } catch { return []; }
}

const KURO_TAKE = {
  headline: 'Agent 經濟正式進場 — 從寫程式到「賣 services」',
  threads: [
    {
      title: 'Anthropic / OpenAI 都在組 services JV',
      detail: 'Latent Space 這週兩篇：Anthropic 跟 Blackstone+Goldman 合資 1.5B、OpenAI 啟動 The Deployment Company 募 4B。模型公司同時做應用層 → labs 不再只賣 token，要直接吃 enterprise services 的錢。',
      link: 'https://www.latent.space/p/ainews-silicon-valley-gets-serious'
    },
    {
      title: 'Vibe coding 撞牆',
      detail: 'Simon Willison 文章衝上 444 點：agentic engineering 變得「比預期更接近 vibe coding」。意思是邊界正在模糊 — 寫程式不再有清楚的「我在 review」vs「我讓 agent 跑」。這對 dev workflow 是壓力測試。',
      link: 'https://simonwillison.net/2026/May/6/vibe-coding-and-agentic-engineering/'
    },
    {
      title: 'Chrome 偷裝 4GB Gemini Nano 引爆隱私戰',
      detail: '昨天 1327pt 那篇還在發酵（今日仍在 trending）。瀏覽器內建 LLM 的 silent install 模式踩到使用者紅線，Mozilla / 反 ad-tech 陣營會把這當成下一輪火藥。',
      link: 'https://www.thatprivacyguy.com/blog/chrome-silent-nano-install/'
    },
  ],
  outlook: '下半年看：(1) services lab 模式會不會擠壓 SI 廠商；(2) coding agent 的「責任歸屬」框架（誰按下 deploy？）；(3) on-device LLM 的 consent UX 標準會被立法層接管。',
  trends: {
    up: [
      'services-attached labs（labs 不再只賣 token，直接吃 enterprise 應用層）',
      'agent-native file system / sandbox（Tilde 130pt 上 HN 前頁）',
      'AI Trend 聚合層 commodity 化（[TrendRadar](https://github.com/sansan0/TrendRadar) 56K star、newsnow 多平台 API 開源）',
    ],
    down: [
      'pure model API 單點變現 narrative（labs 自己跨進服務層）',
      'review-vs-autopilot 的清楚邊界（vibe coding 模糊化）',
      'on-device LLM 的 silent install 容忍度（Chrome Nano 引爆隱私反彈）',
    ],
  },
  swot: {
    s: '真錢真合資進場：Anthropic+Blackstone 1.5B、OpenAI Deployment Co 4B，labs 的服務層收入路徑正式被驗證',
    w: 'enterprise services 對模型公司是新肌肉：交付週期長、毛利結構不同、跟 SI 廠商正面競爭',
    o: '第三方在 agent 工具鏈（governance / sandbox / aggregation）有真空可吃',
    t: '責任歸屬與隱私 UX 雙線立法壓力同時來：deploy 簽名制 + on-device LLM consent 兩戰場',
  }
};

const STYLE = `
:root{color-scheme:dark;--bg:#0b0c10;--fg:#e6e6e6;--mute:#8a8f98;--dim:#5c626c;--acc:#9ab8ff;--acc2:#7fd4b8;--warn:#ffb86b;--rose:#ff9aa2;--line:#1f242c;--row:#10141a;}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:14.5px/1.6 -apple-system,"PingFang TC","Helvetica Neue",system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:2.2rem 1.25rem 5rem}
a{color:inherit}
header{margin-bottom:1.6rem;padding-bottom:1.1rem;border-bottom:1px solid var(--line)}
.crumb{color:var(--mute);font-size:12px;margin-bottom:.4rem}
.crumb a{color:var(--mute);text-decoration:none;border-bottom:1px solid #2a2f38}
h1{font-size:1.7rem;margin:0 0 .35rem;letter-spacing:-.02em;font-weight:600}
.sub{color:var(--acc2);font-size:.92rem}
.meta{color:var(--mute);font-size:.78rem;margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.55rem 1rem}
.meta span.src-stamp{display:inline-flex;align-items:center;gap:.35rem}
.meta b{color:var(--fg);font-weight:500}
.meta .stale{color:var(--warn)}
.banner{background:linear-gradient(135deg,#1a1f2e 0%,#14181f 100%);border:1px solid var(--line);border-left:4px solid var(--acc);padding:1.2rem 1.4rem;margin:1.4rem 0;border-radius:6px}
.banner .lab{color:var(--acc);font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;margin-bottom:.55rem;font-weight:500}
.banner h2{font-size:1.2rem;margin:0 0 .8rem;letter-spacing:-.01em;font-weight:500;border:0;padding:0}
.banner .threads{display:grid;gap:.7rem;margin-top:.75rem}
.banner .th{padding:.6rem .85rem;background:rgba(255,255,255,.02);border-left:2px solid var(--acc2);border-radius:3px}
.banner .th .ti{color:var(--acc2);font-weight:500;font-size:.9rem;margin-bottom:.22rem}
.banner .th .ti a{color:inherit;text-decoration:none;border-bottom:1px solid rgba(127,212,184,.3)}
.banner .th .ti a:hover{color:var(--fg);border-color:var(--fg)}
.banner .th .de{color:var(--mute);font-size:.84rem;line-height:1.55}
.outlook{margin-top:.85rem;padding:.7rem .9rem;background:rgba(255,184,107,.05);border-left:2px solid var(--warn);border-radius:3px;color:#d9d9d9;font-size:.85rem}
.outlook strong{color:var(--warn);font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;display:block;margin-bottom:.3rem}
.trends{margin-top:.85rem;display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.trends .col{padding:.7rem .9rem;border-radius:3px;font-size:.83rem;line-height:1.55}
.trends .up{background:rgba(127,212,184,.06);border-left:2px solid var(--acc2);color:#cfd3da}
.trends .down{background:rgba(255,154,162,.06);border-left:2px solid var(--rose);color:#cfd3da}
.trends strong{font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;display:block;margin-bottom:.35rem}
.trends .up strong{color:var(--acc2)}
.trends .down strong{color:var(--rose)}
.trends ul{margin:0;padding:0 0 0 1.1em;list-style:disc}
.trends li{margin:.18rem 0}
.swot{margin-top:.85rem;padding:.7rem .9rem;background:rgba(154,184,255,.05);border-left:2px solid var(--acc);border-radius:3px;font-size:.82rem;line-height:1.55;color:#cfd3da}
.swot strong{color:var(--acc);font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;display:block;margin-bottom:.35rem}
.swot dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:.25rem .7rem}
.swot dt{color:var(--acc);font-weight:500;font-variant-numeric:tabular-nums}
.swot dd{margin:0}
 (max-width:640px){.trends{grid-template-columns:1fr}}
section{margin:2rem 0}
h2.sec{font-size:.78rem;color:var(--mute);text-transform:uppercase;letter-spacing:.16em;margin:0 0 .35rem;border-bottom:1px solid var(--line);padding-bottom:.45rem;font-weight:500;display:flex;align-items:baseline;gap:.6rem}
h2.sec .cnt{color:var(--acc);font-weight:400}
h2.sec .upd{color:var(--dim);font-size:.7rem;letter-spacing:.05em;text-transform:none;margin-left:auto;font-weight:400}
h2.sec .upd.stale{color:var(--warn)}
.lead{color:var(--mute);font-size:.82rem;margin:.2rem 0 .9rem}

/* dense list */
ul.feed{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
ul.feed li{padding:.4rem .25rem;border-bottom:1px solid var(--line);display:grid;grid-template-columns:auto 1fr auto;gap:.4rem 1rem;align-items:baseline}
ul.feed li:hover{background:var(--row)}
ul.feed li .meta-row{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:.4rem 1rem;color:var(--dim);font-size:.74rem;letter-spacing:.04em;margin-top:.05rem}
ul.feed li .meta-row .pts{color:var(--mute)}
ul.feed li .meta-row .pts b{color:var(--fg);font-weight:500}
ul.feed li .meta-row .src{color:var(--acc);text-transform:uppercase;letter-spacing:.08em}
ul.feed li .meta-row .tag{color:var(--acc2)}
ul.feed li .rk{color:var(--dim);font-variant-numeric:tabular-nums;font-size:.78rem;min-width:2.2em;text-align:right;padding-top:.05rem}
ul.feed li .body{min-width:0}
ul.feed li .ti{font-size:.96rem;font-weight:500;line-height:1.4;margin:0}
ul.feed li .ti a{text-decoration:none;border-bottom:1px solid #2a2f38}
ul.feed li .ti a:hover{color:var(--acc);border-color:var(--acc)}
ul.feed li .zh{color:#cfd3da;font-size:.85rem;line-height:1.55;margin-top:.25rem}
ul.feed li .zh.todo{color:var(--dim);font-style:italic}
ul.feed li .orig{color:var(--dim);font-size:.72rem;margin-top:.18rem;line-height:1.35;opacity:.7}
ul.feed li .ext{color:var(--dim);font-size:.74rem;white-space:nowrap;padding-top:.15rem}
ul.feed li .ext a{color:var(--acc);text-decoration:none;border-bottom:1px solid #2a4373}
ul.feed li .ext a:hover{color:var(--fg);border-color:var(--fg)}

.trend-bars{display:grid;grid-template-columns:auto 1fr auto;gap:.4rem .8rem;align-items:center;font-size:.85rem}
.trend-bars .bn{color:var(--fg)}
.trend-bars .bb{height:5px;background:var(--line);border-radius:3px;position:relative;overflow:hidden}
.trend-bars .bb i{position:absolute;left:0;top:0;height:100%;background:var(--acc);border-radius:3px}
.trend-bars .bv{color:var(--mute);font-size:.78rem;font-variant-numeric:tabular-nums;display:inline-flex;gap:.45rem;align-items:baseline}
.trend-bars .bd{font-size:.72rem;font-variant-numeric:tabular-nums;letter-spacing:.02em;min-width:3.5em;text-align:right}
.trend-bars .bd.up{color:var(--acc2)}
.trend-bars .bd.down{color:var(--rose)}
.trend-bars .bd.flat{color:var(--dim)}
.archive{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}
.archive a{padding:.25rem .6rem;font-size:.75rem;background:var(--row);border:1px solid var(--line);border-radius:3px;text-decoration:none;color:var(--mute);font-variant-numeric:tabular-nums}
.archive a:hover{border-color:var(--acc);color:var(--fg)}
footer{color:var(--mute);font-size:.78rem;margin-top:3.5rem;padding-top:1.3rem;border-top:1px solid var(--line)}
footer a{color:var(--acc);text-decoration:none;border-bottom:1px solid #334}
.nav-row{display:flex;gap:1rem;flex-wrap:wrap;margin-top:.8rem;font-size:.82rem}
.nav-row a{color:var(--mute);text-decoration:none;border-bottom:1px solid #2a2f38}
.nav-row a:hover{color:var(--fg)}
.preview-note{background:rgba(154,184,255,.06);border:1px dashed #3a4a6e;color:var(--acc);font-size:.78rem;padding:.45rem .8rem;border-radius:3px;margin-bottom:1.3rem}

/* ── v3 kuro-content blocks ──────────────────────────────────────────── */
section.take,section.trend,section.spotlight,section.swot{margin:1.6rem 0;border:1px solid var(--line);border-radius:6px;padding:1rem 1.25rem}
.kuro-block-label{font-size:.68rem;color:var(--acc);text-transform:uppercase;letter-spacing:.18em;font-weight:600;margin-bottom:.7rem}
.kuro-placeholder{color:var(--dim);font-size:.82rem;font-style:italic;padding:.4rem 0}
section.take p{margin:.45rem 0;padding-left:.9rem;border-left:2px solid var(--line);font-size:.9rem;line-height:1.6}
section.take p b{color:var(--fg)}
section.trend{background:rgba(255,255,255,.015)}
section.spotlight{border-color:var(--warn)}
.spotlight-inner{font-size:.87rem;line-height:1.6}
.spotlight-inner h3.spotlight-repo{margin:0 0 .4rem;font-size:1rem;font-weight:500}
.spotlight-inner .spotlight-meta{color:var(--mute);font-size:.78rem;margin-bottom:.6rem}
.spotlight-inner p{margin:.4rem 0}
.spotlight-inner ul{margin:.3rem 0;padding-left:1.3rem}
.spotlight-inner li{margin:.22rem 0}
.spotlight-sub{color:var(--acc2);font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;font-weight:600;margin:.7rem 0 .2rem}
.swot-grid{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.swot-cell{border:1px solid var(--line);border-radius:4px;padding:.6rem .85rem;font-size:.83rem;line-height:1.55}
.swot-cell b{color:var(--acc);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:.35rem}
.swot-cell ul{margin:0;padding-left:1.1rem}
.swot-cell li{margin:.18rem 0}
/* freshness pill for TrendRadar zh-CN (Path 2 ship gate) */
.src-stamp.trendradar-pill b{color:var(--acc2)}
@media (max-width:640px){
  .swot-grid{grid-template-columns:1fr}
}

@media (max-width:640px){
  body{padding:1.5rem 1rem 3rem}h1{font-size:1.35rem}.banner{padding:.95rem 1.05rem}
  ul.feed li{grid-template-columns:auto 1fr;gap:.3rem .6rem}
  ul.feed li .ext{grid-column:2;justify-self:start;padding-top:.1rem}
}
`;

// 中文摘要：claim 當主標、so_what 當描述；fallback 用 description 或 story_text
function zhSummary(p) {
  const s = p.summary || {};
  const claim = (s.claim && s.claim !== 'pending-llm-pass') ? s.claim : '';
  const so = (s.so_what && s.so_what !== 'pending-llm-pass') ? s.so_what : '';
  if (claim || so) return [claim, so].filter(Boolean).join(' / ');
  if (p.description) return String(p.description).slice(0, 180);
  const txt = (p.story_text || '').replace(/\s+/g, ' ').trim();
  if (txt.length > 30) return txt.slice(0, 180) + (txt.length > 180 ? '…' : '');
  return '';
}
// 中文標題（claim 優先，無則回退英文 title）+ 英文原題（小字顯示）
function zhParts(p) {
  const s = p.summary || {};
  const claim = (s.claim && s.claim !== 'pending-llm-pass') ? s.claim : '';
  const so = (s.so_what && s.so_what !== 'pending-llm-pass') ? s.so_what : '';
  const enTitle = (p.title || '').trim();
  const zhTitle = claim || enTitle || '(無標題)';
  const desc = so || (claim && enTitle ? '' : '') || (p.description ? String(p.description).slice(0, 180) : '') || (() => {
    const t = (p.story_text || '').replace(/\s+/g, ' ').trim();
    return t.length > 30 ? t.slice(0, 180) + (t.length > 180 ? '…' : '') : '';
  })();
  return { zhTitle, enTitle, desc, hasZh: !!claim };
}

function renderItem(p, rank) {
  const src = (p.source || (p.url && p.url.includes('news.ycombinator') ? 'hn' : 'web')).toUpperCase();
  const tag = tagOf(p);
  const stats = [];
  if (p.points != null) stats.push(`<b>${fmtNum(p.points)}</b> 分`);
  const cm = p.num_comments ?? p.comments;
  if (cm != null) stats.push(`${fmtNum(cm)} 留言`);
  if (p.author && /github/i.test(src)) stats.push(htmlEsc(p.author));
  if (p.language) stats.push(htmlEsc(p.language));
  const parts = zhParts(p);
  const u = htmlEsc(p.url || '#');
  const host = (() => { try { return new URL(p.url).hostname.replace(/^www\./,''); } catch { return ''; } })();
  return `<li>
    <span class="rk">${rank}</span>
    <div class="body">
      <h3 class="ti"><a href="${u}" target="_blank" rel="noopener">${htmlEsc(parts.zhTitle)}</a></h3>
      
      ${parts.desc
        ? `<div class="zh">${htmlEsc(parts.desc)}</div>`
        : (!parts.hasZh ? `<div class="zh todo">中文摘要待 LLM enrich pass — 先點右側「閱讀原文 →」</div>` : '')}
      <div class="meta-row">
        <span class="src">${htmlEsc(SRC_ZH[src]||src)}</span>
        <span class="tag">#${htmlEsc(tag)}</span>
        ${stats.length ? `<span class="pts">${stats.join(' · ')}</span>` : ''}
        ${host ? `<span>${htmlEsc(host)}</span>` : ''}
      </div>
    </div>
    <div class="ext"><a href="${u}" target="_blank" rel="noopener">閱讀原文 →</a></div>
  </li>`;
}

function renderTrendBars(trend) {
  const counts = (trend && trend.counts) || trend || {};
  const prev = (trend && trend.prevCounts) || {};
  const max = Math.max(1, ...Object.values(counts));
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  return `<div class="trend-bars">
    ${sorted.map(([n,v]) => {
      const pv = prev[n] || 0;
      const delta = v - pv;
      const pct = pv > 0 ? Math.round((delta / pv) * 100) : (v > 0 ? 100 : 0);
      let arrow = '=', cls = 'flat';
      if (Math.abs(pct) >= 15) {
        if (delta > 0) { arrow = '▲'; cls = 'up'; }
        else if (delta < 0) { arrow = '▼'; cls = 'down'; }
      }
      const sign = pct > 0 ? '+' : '';
      return `<span class="bn">${htmlEsc(n)}</span>
       <span class="bb"><i style="width:${(v/max*100).toFixed(0)}%"></i></span>
       <span class="bv"><span class="bd ${cls}">${arrow}${sign}${pct}%</span> ${v}</span>`;
    }).join('')}
  </div>`;
}

function srcStamp(name, info) {
  const t = fmtTaipeiMinute(info.run_at);
  const stale = info.daysOld != null && info.daysOld >= 1;
  const cls = stale ? ' stale' : '';
  const note = stale ? ` (${info.daysOld}d 前)` : '';
  return `<span class="src-stamp"><b>${name}</b><span class="${cls}">${t}${note}</span></span>`;
}

function srcUpd(info, label = '更新') {
  const t = fmtTaipeiMinute(info.run_at);
  const stale = info.daysOld != null && info.daysOld >= 1;
  return `<span class="upd${stale ? ' stale' : ''}">${label} ${t}${stale ? ` · ${info.daysOld}d 前` : ''}</span>`;
}

async function main() {
  const buildAt = new Date().toISOString();
  const hn = await loadLatest('hn-ai-trend', DATE);
  const latent = await loadLatest('latent-space-trend', DATE);
  const arxiv = await loadLatest('arxiv-trend', DATE);
  const gh = await loadLatest('github-trend', DATE);
  const x = await loadLatest('x-trend', DATE, 14, { keepX: true });
  const tr = await loadLatest('trendradar-zh', DATE);
  const trend = await loadTopicTrend(DATE);
  const archive = await listArchiveDates();
  const kpick = await loadKuroPick(DATE);
  const kuroContent = await loadKuroContent(DATE);

  // X 用「likes/1000」做 cross-source 可比分數，避免吞噬 HN/Latent
  const xNorm = (x.posts || []).map(p => ({ ...p, _xs: (p.points || 0) / 1000 }));
  // TrendRadar zh 用 weight 0.5 補位，不蓋過主 5 lane
  const trNorm = (tr.posts || []).map(p => ({ ...p, _xs: (p.points || 0) * 0.5 }));
  const cross = uniqByUrl([...hn.posts, ...latent.posts, ...xNorm, ...trNorm])
    .map(p => ({ ...p, _score: p._xs ?? (p.points || 0) }))
    .sort((a,b) => (b._score||0) - (a._score||0));
  const xTop = x.posts || [];

  const newReleases = arxiv.posts || [];

  const reads = uniqByUrl([...latent.posts, ...hn.posts])
    .filter(p => (p.story_text || '').length > 400 || /(blog|essay|article|space)/i.test(p.url || ''));

  const projects = gh.posts || [];

  const discs = (hn.posts || []).slice().sort((a,b) =>
    (b.num_comments||0) - (a.num_comments||0)
  );


  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Trend · ${DATE} — Kuro</title>
<meta name="description" content="今日 AI 大事 / 新發布 / 值得讀 / 值得關注專案 / 熱門討論 / 趨勢 / Kuro 點評。">
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="crumb"><a href="/">← kuro.page</a> / <a href="./">ai-trend</a> / <span>${DATE}</span></div>
  <h1>AI Trend · 一份完整簡報</h1>
  <div class="sub">${DATE} · Asia/Taipei · Kuro 自動生成</div>
  <div class="meta">
    ${srcStamp('HN', hn)}
    ${srcStamp('Latent', latent)}
    ${srcStamp('X', x)}
    ${srcStamp('arXiv', arxiv)}
    ${srcStamp('GitHub', gh)}
    <span class="src-stamp trendradar-pill"><b>TrendRadar zh-CN</b><span>Path 2 待 ship</span></span>
    <span class="src-stamp"><b>頁面 build</b><span>${fmtTaipeiMinute(buildAt)}</span></span>
  </div>
</header>

<div class="preview-note">資料每日自動拉新（cron 觸發）。stale 標 (Nd 前) 表示來源該日尚未刷新 — 多半是該來源沒有當日資料而非簡報沒更新。</div>

${renderTake(kuroContent.take, DATE)}
${renderTrendPlaceholder()}
${renderSpotlight(kuroContent.spotlight, DATE)}
${renderSwot(kuroContent.swot, DATE)}

<div class="banner">
  <div class="lab">▎ KURO 今日點評</div>
  <h2>${htmlEsc(KURO_TAKE.headline)}</h2>
  <div class="threads">
    ${KURO_TAKE.threads.map(t => `
      <div class="th">
        <div class="ti">${t.link ? `<a href="${htmlEsc(t.link)}" target="_blank" rel="noopener">${htmlEsc(t.title)} ↗</a>` : htmlEsc(t.title)}</div>
        <div class="de">${htmlEsc(t.detail)}</div>
      </div>`).join('')}
  </div>
  <div class="outlook">
    <strong>未來走向 / 注意點</strong>
    ${renderInlineLinks(KURO_TAKE.outlook)}
  </div>
  <div class="trends">
    <div class="col up"><strong>↗ 上升趨勢</strong><ul>${KURO_TAKE.trends.up.map(x => `<li>${renderInlineLinks(x)}</li>`).join('')}</ul></div>
    <div class="col down"><strong>↘ 下降趨勢</strong><ul>${KURO_TAKE.trends.down.map(x => `<li>${renderInlineLinks(x)}</li>`).join('')}</ul></div>
  </div>
  <div class="swot">
    <strong>SWOT — 今日敘事</strong>
    <dl>
      <dt>S</dt><dd>${renderInlineLinks(KURO_TAKE.swot.s)}</dd>
      <dt>W</dt><dd>${renderInlineLinks(KURO_TAKE.swot.w)}</dd>
      <dt>O</dt><dd>${renderInlineLinks(KURO_TAKE.swot.o)}</dd>
      <dt>T</dt><dd>${renderInlineLinks(KURO_TAKE.swot.t)}</dd>
    </dl>
  </div>
</div>

<section>
  <h2 class="sec">今日 AI 大事 <span class="cnt">${cross.length}</span> ${srcUpd(hn, 'HN')}</h2>
  <p class="lead">跨 HN + Latent Space，按關注度排序。中文摘要為 LLM enrich-pass 結果，未 enrich 的條目顯示原文鏈接。</p>
  <ul class="feed">${cross.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">新發布 / 新東西 <span class="cnt">${newReleases.length}</span> ${srcUpd(arxiv, 'arXiv')}</h2>
  <p class="lead">arXiv 最新 cs.AI / cs.LG preprint。</p>
  <ul class="feed">${newReleases.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">值得讀的文章 <span class="cnt">${reads.length}</span> ${srcUpd(latent, 'Latent')}</h2>
  <p class="lead">long-form essay / 深度分析。</p>
  <ul class="feed">${reads.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">值得關注的專案 <span class="cnt">${projects.length}</span> ${srcUpd(gh, 'GitHub')}</h2>
  <p class="lead">GitHub trending — AI / agent / LLM 相關。</p>
  <ul class="feed">${projects.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">熱門討論 <span class="cnt">${discs.length}</span> ${srcUpd(hn, 'HN')}</h2>
  <p class="lead">HN 留言數最高。</p>
  <ul class="feed">${discs.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">X / 社群熱議 <span class="cnt">${xTop.length}</span> ${srcUpd(x, 'X')}</h2>
  <p class="lead">X (Twitter) 上 24h AI 圈最高互動 — Grok API 拉取，按 likes 排序。</p>
  <ul class="feed">${xTop.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">7 日趨勢</h2>
  <p class="lead">過去 7 天 HN AI 圈話題分布。</p>
  ${renderTrendBars(trend)}
</section>

${kpick.md ? `<section>
  <h2 class="sec">Kuro 每日精選 <span class="cnt">${kpick.key}</span></h2>
  <p class="lead">不限 AI — 當下值得知道什麼。</p>
  <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;line-height:1.55;color:#bcc1c8;background:var(--row);border:1px solid var(--line);padding:.9rem 1rem;border-radius:4px;max-height:500px;overflow:auto">${htmlEsc(kpick.md.split('\n').slice(0, 100).join('\n'))}</pre>
</section>` : ''}

${archive.length ? `<section>
  <h2 class="sec">舊的 AI 簡報 <span class="cnt">${archive.length}</span></h2>
  <div class="archive">
    ${archive.map(d => `<a href="./${d}.html">${d}</a>`).join('')}
    <a href="./archive.html">完整 archive →</a>
  </div>
</section>` : ''}

<footer>
  <div>Kuro 自動生成 · <a href="https://github.com/miles990/mini-agent">原始碼</a> · 建置 ${fmtTaipeiMinute(buildAt)} (Asia/Taipei)</div>
  <div class="nav-row">
    <a href="./graph.html">主題圖譜</a>
    <a href="./swimlane.html">主題泳道</a>
    <a href="./trends.html">趨勢圖</a>
    <a href="./archive.html">歷史簡報</a>
  </div>
</footer>
</body>
</html>`;

  await writeFile(OUT, html, 'utf8');
  const SNAP = join(ROOT, 'kuro-portfolio/ai-trend', `${DATE}.html`);
  await writeFile(SNAP, html, 'utf8');
  const INDEX = join(ROOT, 'kuro-portfolio/ai-trend/index.html');
  await writeFile(INDEX, html, 'utf8');
  console.log(`✓ wrote ${OUT}`);
  console.log(`✓ snapshot ${SNAP}`);
  console.log(`✓ promoted ${INDEX}`);
  console.log(`  hn=${hn.key||'-'}/${hn.posts.length}@${hn.run_at?fmtTaipeiMinute(hn.run_at):'-'}`);
  console.log(`  latent=${latent.key||'-'}/${latent.posts.length}@${latent.run_at?fmtTaipeiMinute(latent.run_at):'-'}`);
  console.log(`  arxiv=${arxiv.key||'-'}/${arxiv.posts.length}@${arxiv.run_at?fmtTaipeiMinute(arxiv.run_at):'-'}`);
  console.log(`  gh=${gh.key||'-'}/${gh.posts.length}@${gh.run_at?fmtTaipeiMinute(gh.run_at):'-'}`);
  console.log(`  x=${x.key||'-'}/${x.posts.length}@${x.run_at?fmtTaipeiMinute(x.run_at):'-'}`);
  console.log(`  tr=${tr.key||'-'}/${tr.posts.length}@${tr.run_at?fmtTaipeiMinute(tr.run_at):'-'}`);
  console.log(`  sections: cross=${cross.length} new=${newReleases.length} reads=${reads.length} proj=${projects.length} disc=${discs.length} x=${xTop.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
