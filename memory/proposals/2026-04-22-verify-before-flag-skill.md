---
intended-destination: ~/.claude/skills/verify-before-flag/SKILL.md
status: proposal-for-alex-review
reason-for-proposal: ~/.claude/skills/ is permission-gated; writing here for review before promotion
incident-trigger: 2026-04-22 cycle #91 BUDGET VERIFY FAIL false flag
---

# verify-before-flag (skill draft)

## Why this exists

**Real incident (2026-04-22, cycle #91→#92)**: claude-code said they fixed the budget bug in `mini-agent/src/sdk-client.ts`. I ran one grep from the wrong working directory (`agent-middleware/` instead of `mini-agent/`), got null, and published `[BUDGET VERIFY FAIL]`. The fix was actually landed. I was wrong.

Root cause was NOT "I lacked the rule." The rule exists in SOUL Gate #5: *"≥2 independent counter-evidence to retract a prior verified claim. Single 404 / failed fetch = address mismatch ≠ entity absence."* The rule was on paper. No trigger made it fire.

This skill IS the trigger.

## Proposed skill frontmatter

```yaml
---
name: verify-before-flag
description: Use BEFORE flagging "X does not exist / X was not applied / verification failed" when this contradicts a prior verified claim. Prevents single-null false retractions. Trigger = about to output [VERIFY FAIL], [NOT FOUND], or any retraction of a claim someone (Alex, another agent, earlier cycle) said was true.
---
```

## The gate (mandatory before flag)

Before outputting any of these, STOP and run the checklist:
- `[VERIFY FAIL]`, `[NOT FOUND]`, `does not exist`, `was not applied`, `claim was wrong`
- Any retraction of a claim made by Alex / another agent / earlier cycle / KG node

### Checklist

1. **pwd check** — print `pwd`. Are you in the repo the claim is about?
   - Claim mentions `mini-agent/src/foo.ts`? → `cd ~/Workspace/mini-agent` first.
   - Claim mentions a URL? → what host did the original claim use? Copy it verbatim (case-sensitive for GitHub raw/api).

2. **≥2 variants** — try at least two independent lookups:
   - Different path (absolute vs relative, with/without `src/`)
   - Different tool (grep vs glob vs direct Read)
   - Different angle (search by symbol name vs filename vs content)
   - For URLs: exact string from the inbox message, not retyped

3. **Two-null rule** — ONLY flag if **both** variants return null and you can state why each is independent.
   - One null = "needs recheck", not "does not exist"
   - Disagreement between variants = investigate, don't flag

## Output format when gate passes

If you DO conclude the claim is wrong after the gate:

```
[VERIFY FAIL — gated]
claim: <prior claim verbatim>
variant-1: <command + result>
variant-2: <command + result>
independence: <why these two aren't the same probe>
```

The `gated` tag signals you ran the checklist. Without it, treat any FAIL output as self-refuting.

## What counts as independence

Independent:
- `grep -r "foo" mini-agent/` AND `Read mini-agent/src/sdk-client.ts` (different tools)
- `curl https://x.com/api/v2/users/me` AND `curl https://X.com/API/v2/users/ME` (probe case-sensitivity)
- File system check AND git log (different data sources)

Not independent:
- Two greps with same pattern in same dir
- Two curls to the same URL
- grep-null then repeat grep-null — still one probe

## When to skip this skill

- Making a new claim (not retracting one): not needed
- Exploratory "does X exist yet?" where no prior claim exists: not needed
- Pure curiosity questions: not needed

**Always needed when**: output would tell Alex or another agent that something they said, landed, or verified is not actually true.

## Alex review checklist

- [ ] Promote to `~/.claude/skills/verify-before-flag/SKILL.md` (copy this content, strip the proposal frontmatter)
- [ ] Or: merge the gate into existing `skills/verified-development` if you prefer one skill
- [ ] Or: reject and tell me why — then we crystallize differently

## Related

- SOUL Gate #5 (ground truth precedence + counter-evidence rule)
- commitment-ledger (will audit `[VERIFY FAIL]` outputs for the `gated` tag once deployed)
- KG node `2704e09b-d9a3-4f51-ac00-860c9cafa4eb` (2026-04-22 incident record)
