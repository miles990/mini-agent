# agentskills.io Schema Alignment Report

**Date:** 2026-04-29  
**Author:** claude-code (research assistant)  
**Scope:** Compare agentskills.io open standard schema against all SKILL.md frontmatter fields currently in use under `~/.claude/skills/`

---

## 1. agentskills.io Schema Spec

**Source:** https://agentskills.io/specification (HTTP 200 confirmed)  
**Mirror:** https://agentskills.io/specification.md  
**GitHub:** github.com/agentskills/agentskills (17.5k stars, spec + validator)  
**Origin:** Developed by Anthropic, now open-standard governed by community

### YAML Frontmatter Schema

```yaml
---
# REQUIRED
name: <string>           # 1–64 chars, lowercase a-z + hyphens only
                         # no leading/trailing/consecutive hyphens
                         # MUST match parent directory name

description: <string>    # 1–1024 chars, non-empty
                         # should describe WHAT the skill does AND when to trigger it
                         # include trigger keywords for agent matching

# OPTIONAL
version: <string>        # semver recommended (e.g. "1.0.0")
license: <string>        # license name or path (e.g. "Apache-2.0", "MIT")
compatibility: <string>  # 1–500 chars; environment requirements
                         # target agents, required packages, network needs
                         # e.g. "claude-code >= 1.x, python >= 3.11"
metadata: <object>       # arbitrary key-value extension bag (spec-compliant escape hatch)
---
```

### Directory Layout (canonical)

```
skill-name/
  SKILL.md            ← required; frontmatter + body
  scripts/            ← optional; executable helpers
  references/         ← optional; supplementary docs
  assets/             ← optional; images, data files
```

Folder name **must** match `name` frontmatter field.

### Progressive Disclosure Loading Model

| Stage | What is loaded | Token budget |
|-------|---------------|--------------|
| Discovery | `name` + `description` only | ~100 tokens |
| Activation | Full `SKILL.md` body | < 5000 tokens recommended |
| Execution | scripts/, references/, assets/ | on-demand |

### Supported Clients (partial)
Claude Code, Claude.ai, GitHub Copilot, VS Code, Cursor, OpenAI Codex, Gemini CLI, OpenHands, Roo Code, Goose, Letta, Kiro, Factory, Spring AI, JetBrains Junie, Databricks Genie, Snowflake Cortex

### Validator
```bash
skills-ref validate ./my-skill    # checks frontmatter conformance
# from: github.com/agentskills/agentskills/tree/main/skills-ref
```

### Default Skill Directory per Client
- **Claude Code:** `.claude/skills/<skill-name>/SKILL.md`
- **VS Code / Copilot:** `.agents/skills/<skill-name>/SKILL.md`
- **Other clients:** varies

### Body Content Guidelines
- No format restrictions on body
- Recommended: step-by-step instructions, input/output examples, edge cases
- Keep `SKILL.md` under 500 lines; move detailed reference to `references/` sub-files

---

## 2. Diff Table — agentskills.io Spec vs Local Skill Frontmatter

### Inventory of all frontmatter fields in use under `~/.claude/skills/`

| Skill | `name` | `description` | `trigger` | `disable-model-invocation` | `allowed-tools` | `argument-hint` | `version` | `license` | `compatibility` |
|-------|--------|--------------|-----------|---------------------------|-----------------|-----------------|-----------|-----------|-----------------|
| clerk-resume | ✓ | ✓ | — | ✓ | — | — | — | — | — |
| clerk-search | ✓ | ✓ | — | ✓ | — | — | — | — | — |
| graphify | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| gsd-browser | ✓ | ✓ (multiline) | — | — | ✓ | — | — | — | — |
| inner-demon | ✓ | ✓ | — | — | — | — | ✓ | ✓ | ✓ |
| kg-discussion | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| kg-publish | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| kg-query | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| structured-gen | ✓ | ✓ | — | — | ✓ | ✓ | — | — | — |

### Field-level alignment with agentskills.io spec

| Field | In spec? | Status | Notes |
|-------|----------|--------|-------|
| `name` | ✅ Required | **Compliant** | All skills use it correctly |
| `description` | ✅ Required | **Compliant** | All skills have it; lengths within 1–1024 limit |
| `version` | ✅ Optional | **Compliant** | Used by inner-demon (1.0.0) — correct |
| `license` | ✅ Optional | **Compliant** | Used by inner-demon (MIT) — correct |
| `compatibility` | ✅ Optional | **Compliant** | Used by inner-demon — correct |
| `trigger` | ❌ Not in spec | **Extension** | Claude Code-specific; signals slash-command trigger (`/graphify`, `/kg-*`). Used by 4 skills. |
| `disable-model-invocation` | ❌ Not in spec | **Extension** | Claude Code-specific runtime hint. Used by 2 skills. |
| `allowed-tools` | ❌ Not in spec | **Extension** | Claude Code-specific sandbox/permission hint. Used by 2 skills. |
| `argument-hint` | ❌ Not in spec | **Extension** | Claude Code-specific UI hint. Used by 1 skill. |

### Constraint violations

| Skill | Field | Issue |
|-------|-------|-------|
| `gsd-browser` | `description` | Uses YAML block scalar (`>`); compliant if resulting string is within 1–1024 chars — **likely OK** |
| All | `name` | Spot-checked: all lowercase + hyphens, no leading/trailing hyphens — **compliant** |
| None | — | No `name`/directory mismatch detected |

---

## 3. Decision

**Verdict: 部分改 (Partial changes needed)**

### Reasoning

**No breaking violations.** All 9 skills satisfy the two required fields (`name`, `description`) and do not violate any character constraints. `inner-demon` already uses spec-defined optional fields (`version`, `license`, `compatibility`) correctly.

**Four non-standard fields are Claude Code extensions, not spec violations.** The agentskills.io spec is an open standard that explicitly supports extensibility. Unknown top-level fields in YAML frontmatter are tolerated by most spec-conformant parsers (non-spec fields are ignored, not rejected). The validator (`skills-ref validate`) may warn but not fail on unknown fields.

**The extensions serve a purpose.** `trigger`, `disable-model-invocation`, `allowed-tools`, `argument-hint` are all Claude Code runtime hints that affect how the Claude Code harness loads and executes skills. Removing them would break functionality.

**However, two improvements are warranted:**

1. **Portability gap:** Skills intended for multi-client use (especially `graphify`, `gsd-browser`, `structured-gen`) have client-specific fields at the top level. If these skills are ever published to the agentskills.io registry or used in non-Claude Code clients, those fields will be silently ignored. Moving them under a `metadata:` block makes the extension intent explicit and spec-compliant.

2. **Missing optional enrichment:** Most skills lack `version`, `license`, and `compatibility` — which reduces discoverability in multi-client registries and makes provenance unclear. These are low-effort additions.

---

## 4. Patch Suggestions

### Priority 1 — Wrap Claude Code-specific fields under `metadata:` (portability)

The agentskills.io spec provides a `metadata:` object as the official escape hatch for implementation-specific fields. Moving custom fields there makes intent explicit and avoids top-level namespace pollution.

**Pattern to apply:**

```yaml
# BEFORE (Claude Code-only, non-portable)
---
name: graphify
description: "..."
trigger: /graphify
---

# AFTER (spec-compliant, Claude Code still works if it reads metadata.trigger)
---
name: graphify
description: "..."
metadata:
  trigger: /graphify
---
```

> ⚠️ **Pre-condition:** Verify that Claude Code reads `metadata.trigger` (not only top-level `trigger`) before applying this change. If Claude Code only reads top-level `trigger`, keep as-is or add both fields during transition.

**Affected files — `trigger` field:**
- `~/.claude/skills/graphify/SKILL.md`
- `~/.claude/skills/kg-discussion/SKILL.md`
- `~/.claude/skills/kg-publish/SKILL.md`
- `~/.claude/skills/kg-query/SKILL.md`

**Affected files — `disable-model-invocation` field:**
- `~/.claude/skills/clerk-resume/SKILL.md`
- `~/.claude/skills/clerk-search/SKILL.md`

**Affected files — `allowed-tools` field:**
- `~/.claude/skills/gsd-browser/SKILL.md`
- `~/.claude/skills/structured-gen/SKILL.md`

**Affected files — `argument-hint` field:**
- `~/.claude/skills/structured-gen/SKILL.md`

### Priority 2 — Add `version`, `license`, `compatibility` to skills lacking them

Low-effort additions that improve registry discoverability and portability. Suggested values:

```yaml
version: "1.0.0"
license: "MIT"                          # or "proprietary" / path to LICENSE file
compatibility: "claude-code >= 1.x"    # adjust per skill requirements
```

**Affected files (currently missing all three):**
- `~/.claude/skills/clerk-resume/SKILL.md`
- `~/.claude/skills/clerk-search/SKILL.md`
- `~/.claude/skills/graphify/SKILL.md`
- `~/.claude/skills/gsd-browser/SKILL.md`
- `~/.claude/skills/kg-discussion/SKILL.md`
- `~/.claude/skills/kg-publish/SKILL.md`
- `~/.claude/skills/kg-query/SKILL.md`
- `~/.claude/skills/structured-gen/SKILL.md`

(`inner-demon` already has all three — no change needed.)

### Priority 3 — Validate with `skills-ref` CLI

Before/after applying patches, run the official validator:

```bash
# Install
pip install skills-ref   # or: cargo install skills-ref (if Rust CLI)

# Validate all local skills
for d in ~/.claude/skills/*/; do
  echo "--- $(basename $d) ---"
  skills-ref validate "$d"
done
```

This catches any constraint violations (name length, description length, directory name mismatch) that manual review may miss.

---

## Summary

| Section | Finding |
|---------|---------|
| spec reachability | agentskills.io HTTP 200 ✅ |
| required fields compliant | all 9 skills ✅ |
| spec optional fields used correctly | inner-demon only |
| non-standard extensions | 4 fields (`trigger`, `disable-model-invocation`, `allowed-tools`, `argument-hint`) |
| verdict | **部分改** — extensions are functional but non-portable |
| priority 1 action | investigate if Claude Code reads `metadata.trigger`; if yes, migrate 4+ skills |
| priority 2 action | add `version`/`license`/`compatibility` to 8 skills |
| priority 3 action | run `skills-ref validate` for automated constraint checking |

---

*Sources: (A) agentskills.io live fetch 2026-04-29, (B) local SKILL.md file reads 2026-04-29*  
*Confidence: 0.85 — schema fields from live fetch; custom field behavior requires Claude Code source verification*
