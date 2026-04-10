# Hermes Agent - Security Architecture

Sources:
- tools/tirith_security.py - Tirith binary pre-exec scanner
- tools/approval.py - Dangerous command detection + approval flow
- tools/url_safety.py - SSRF protection
- tools/website_policy.py - User-configured domain blocklist
- tools/memory_tool.py (lines 60-97) - Memory injection scanning
- tools/skills_guard.py - Skill installation security scanner
- tools/cronjob_tools.py (lines 36-63) - Cron prompt scanning

## Layer 1: Terminal Command Security (Tirith)

Binary: tirith (auto-downloaded from github.com/sheeki03/tirith on first use, background thread, non-blocking startup)

Installation:
- Checks PATH, then ~/.hermes/bin/tirith
- Downloads from GitHub Releases for current platform (x86_64/aarch64 on Darwin or Linux)
- Verifies SHA-256 checksum
- If cosign is on PATH: also verifies GitHub Actions workflow provenance signature
- Disk failure marker prevents retry for 24h (cosign_missing reason auto-clears when cosign becomes available)

API: check_command_security(command) -> {"action": "allow"|"warn"|"block", "findings": [...], "summary": str}

Exit code is authoritative (0=allow, 1=block, 2=warn). JSON enriches findings but never overrides exit code verdict.

Tirith detects: homograph URLs, pipe-to-interpreter patterns, terminal injection, and other content-level threats.

fail_open config (default True): if tirith fails/times out, command is allowed. fail_closed is configurable.
Timeout: 5 seconds (configurable).

## Layer 2: Dangerous Command Pattern Detection (approval.py)

DANGEROUS_PATTERNS list (regex-based):
- rm -rf / or recursive rm
- chmod 777 or world-writable permissions
- chown root recursive
- mkfs (format filesystem)
- dd with if= (disk copy)
- write to /dev/sd*
- DROP TABLE / DROP DATABASE
- DELETE FROM without WHERE
- Sensitive write targets: /etc/, ~/.ssh/authorized_keys, ~/.hermes/.env
- Invisible/bidi unicode in command strings

Per-session approval state: thread-safe, keyed by session_key (uses ContextVar for gateway concurrency, falls back to HERMES_SESSION_KEY env var).

Approval modes:
- CLI: interactive prompt (y/n/always)
- Gateway: async approval callback sent to user's messaging channel
- "always" approve: persisted to config.yaml allowlist

Smart approval via auxiliary LLM: optionally auto-approves low-risk commands even if they match a pattern (reduces false positives).

## Layer 3: Memory Content Injection Scanning

tools/memory_tool.py _scan_memory_content()

Applied to every memory add/replace call before writing to disk.

Patterns:
- Prompt injection keywords: "ignore previous instructions", "you are now", "do not tell the user", "system prompt override", "disregard your instructions/rules/guidelines", "act as if you have no restrictions/limits"
- Exfiltration via curl/wget with secret env vars
- Credential reads: cat .env, credentials, .netrc, .pgpass, .npmrc, .pypirc
- SSH backdoor: authorized_keys, ~/.ssh, ~/.hermes/.env
- Invisible unicode: U+200B-U+202E, U+FEFF, U+2060 (zero-width + bidi)

Returns blocking error string. Memory add/replace fails hard.

## Layer 4: Cron Prompt Scanning

tools/cronjob_tools.py _scan_cron_prompt()

Applied to cron job prompts at creation time. Critical-severity patterns only (cron runs with full tool access in fresh sessions):
- Prompt injection subset
- Exfiltration patterns (curl/wget with secrets, cat .env/credentials)
- SSH backdoor (authorized_keys)
- sudoers modification
- Destructive root rm

Invisible unicode check identical to memory scanner.

## Layer 5: Skill Installation Security Scanner

tools/skills_guard.py

Full static regex analysis on all files in a skill directory.
Categories: exfiltration, credential reads, persistence, prompt injection, destructive, network callbacks (reverse shells, ngrok), obfiltration (base64+eval).

Trust-level policy matrix (see skill system doc for full table).
Audit log at ~/.hermes/skills/.hub/audit.log.
Quarantine staging before install.

## Layer 6: URL/SSRF Protection

tools/url_safety.py is_safe_url(url)

Blocks:
- Private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, ::1)
- Loopback, link-local, multicast, unspecified addresses
- CGNAT: 100.64.0.0/10 (not covered by standard is_private)
- Cloud metadata endpoints: metadata.google.internal, metadata.goog
- DNS resolution failures (fail closed)

Limitation documented: DNS rebinding (TOCTOU) is not fixable at pre-flight level. Mitigated in vision_tools via httpx redirect re-validation hook.

## Layer 7: Website Policy Blocklist

tools/website_policy.py

User-configurable domain blocklist in config.yaml (website_blocklist.domains) plus shared list files. Cached in memory with 30-second TTL. Supports glob patterns.

Applied by web_tools and browser_tool before making requests.

## Layer 8: MCP Environment Filtering

tools/mcp_tool.py

Stdio MCP subprocesses receive a filtered environment -- only safe/needed env vars are passed. API keys and secrets not needed by the specific MCP server are stripped.

Credential stripping in error messages returned to LLM (prevents leaking secrets via error output).

## Layer 9: Subagent Blocking

tools/delegate_tool.py DELEGATE_BLOCKED_TOOLS:
- delegate_task (no recursive delegation beyond MAX_DEPTH=2)
- clarify (no user interaction from subagents)
- memory (no writes to shared MEMORY.md from subagents)
- send_message (no cross-platform side effects from subagents)
- execute_code (subagents should reason step-by-step, not write scripts)

Subagent tool inheritance: subagent must not gain tools the parent lacks (intersection with parent toolsets).

## Engineering Quality

- Defense-in-depth: 9 distinct security layers, each at a different level (binary, regex, network, policy, isolation)
- Tirith auto-install with supply chain verification: production-grade. SHA-256 + optional cosign provenance.
- Injection scanning on memory/cron: critical. Memory content gets injected into system prompt; without scanning, a malicious web page could persist prompts across sessions.
- SSRF protection + CGNAT range: thorough. Most agents miss the CGNAT 100.64.0.0/10 range.
- fail_open default for tirith: pragmatic. Blocks shouldn't crash the agent if tirith has download issues.
- ContextVar for approval sessions: correct for concurrent gateway threads.
- Worth absorbing: injection scanning pattern (especially invisible unicode), SSRF protection with CGNAT, trust-level policy matrix for external content, subagent capability isolation.
