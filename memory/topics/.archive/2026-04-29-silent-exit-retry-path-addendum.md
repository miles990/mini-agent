# 2026-04-29 silent_exit retry-path addendum: attempt=3/3 leak to 64k

**Task source**: heartbeat follow-up `[follow-up from 2026-04-25 silent_exit grading]` —
"調查 attempt=3/3 在 E' ship 後仍漏到 64k 的 retry 路徑（具體案例：2026-04-24 13:02:29 prompt=63917）"

**Method**: read-only source audit `/Users/user/Workspace/mini-agent/src/agent.ts:1740–2020`.
No source modification (malware-guard active). Findings only.

## 三條 retry rebuild 分支（agent.ts:1984–2013）

調用點：`callClaude` 函數，外層 `for (let attempt = 0; attempt <= maxRetries; attempt++)`，
`maxRetries = 2` → attempts 1/3, 2/3, 3/3。E' ship（commit 67c40914）改的是
`memory.ts:3668 buildMinimalContext(budget?)` 讓 minimal-mode 不再忽略 contextBudget。
從 agent.ts call site 看哪些分支真的觸發 buildMinimalContext：

### Branch A — `classified.type === 'TIMEOUT' && errToolCount === 0` (L1984–1986)

```ts
slog('RETRY', `TIMEOUT tools=0 on attempt ${attempt + 1} — API-side issue,
              skipping rebuildContext, retrying same prompt (${fullPrompt.length} chars)
              in ${delay / 1000}s`);
```

**結論**：tools=0 fast-fail 路徑**明確跳過 rebuildContext**。E' fix 完全不參與。
若 attempt 1/3 構築出 ~64k prompt，attempts 2/3 + 3/3 會原樣重發 ~64k。
這是 **64k 漏洞的最強嫌疑分支**。

證據鏈：64k = `PROMPT_HARD_CAP` 名義值，63917 chars 接近此 cap。tools=0 表示
Claude 連 tool-call 都沒 emit 就 timeout/silent-exit → 通常 API 端問題。
此分支假設「context 不是問題」所以不重建，但若初次 prompt 本身就壓在 cap 上，
全部 3 次 attempt 都在 cap 上炸。

### Branch B — `TIMEOUT && tools > 0 && rebuildContext exists` (L1987–2007)

```ts
const minimalSystemPrompt = getSystemPrompt(prompt, options?.cycleMode, 'minimal');
const minimalBudget = PROMPT_HARD_CAP - minimalSystemPrompt.length - prompt.length - 20;
currentContext = await options.rebuildContext('minimal', minimalBudget);
fullPrompt = `${minimalSystemPrompt}\n\n${currentContext}\n\n${errorTrace}\n\n---\n\nUser: ${prompt}`;
```

**結論**：budget 正確 thread 給 rebuildContext，E' fix 在此 branch 生效。
唯一風險：rebuildContext 實作端是否真的 honor budget（caller 端 OK）。

注意：`errorTrace` 字串 ~200 chars 會 append。若 rebuildContext 用滿 budget，
則 `fullPrompt = sysPrompt + budget滿 + 200 + 20 = PROMPT_HARD_CAP`，**剛好踩 cap**。
不超出，但毫無 headroom。

### Branch C — non-TIMEOUT retryable error (L2008–2013)

```ts
const errorTrace = `\n\n## Previous Attempt Failed\nType: ${classified.type} | Guidance: ...`;
fullPrompt = fullPrompt.replace('\n\n---\n\nUser: ', `${errorTrace}\n\n---\n\nUser: `);
```

**結論**：完全不重建 context，只在 fullPrompt 裡塞 errorTrace。
如果初次 prompt 就是 64k，attempts 2/3 + 3/3 = 64k + ~200 chars × N 越積越大。
非 TIMEOUT 的 retryable 錯誤（rate-limit / overload / transient）會走這路徑。

### Branch D — rebuildContext throws (L1997–2006 emergency fallback)

```ts
const minimalSystemPrompt = getSystemPrompt(prompt, options?.cycleMode, 'minimal');
fullPrompt = `${minimalSystemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;
```

**結論**：emergency fallback 只 strip system prompt，**沿用既有 `currentContext`**。
若 currentContext 已是 64k 規模，attempts 2/3 + 3/3 還是 64k-ish。E' fix 不參與。

## §13:23（先前 plan 提到的覆蓋範圍）vs 本次發現

E' fix（buildMinimalContext budget honoring）只解決一條路徑：
**Branch B 的 rebuildContext 真的被叫到** + **rebuildContext callback 真的調用 buildMinimalContext**。

漏掉的：
- Branch A（TIMEOUT tools=0）— 設計上跳過
- Branch C（non-TIMEOUT retryable）— 不重建
- Branch D（rebuildContext throw）— 不重建

**2026-04-24 13:02:29 prompt=63917 案例最可能落在 Branch A**（API-side silent-exit
是 tools=0 的典型簽名）。要驗證需查當時 error 的 `errToolCount`，但 plan 文件
裡可能已記錄。

## 不做什麼（malware-guard）

不寫 patch、不動 src/。本文件純源碼審查記錄，作為 plan addendum 證據用。

## 落點建議（給 Alex review）

要堵 attempt=3/3 在 64k 級別不下降的洞，需要在 Branch A 也加 size-clamp：
若 `fullPrompt.length > SOME_THRESHOLD`（如 0.9 * PROMPT_HARD_CAP），即使 tools=0
也要做一次 minimal rebuild（畢竟 prompt 本身過大也是 silent-exit 嫌疑因子之一）。
但這違反「tools=0 = API-side, 不浪費時間 rebuild」的設計 intent，需 Alex 拍板權衡。

## Falsifier

若 grep error log 找到 attempt=3/3 + prompt<10k 的 silent_exit case → 這份分析的
「64k 路徑只在 Branch A/C/D」結論被推翻，需重新審查 Branch B 的 rebuildContext 實作。
