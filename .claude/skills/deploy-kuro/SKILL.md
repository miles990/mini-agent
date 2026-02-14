---
name: deploy-kuro
description: Deploy Kuro changes through CI/CD pipeline with pre-flight checks and post-deploy verification
user_invocable: true
---

# Deploy Kuro

Standardized deployment flow: test → audit → commit → push → wait for settle → verify.

## Steps

1. **Pre-flight: Type check**
   ```bash
   cd $CLAUDE_PROJECT_DIR && pnpm typecheck
   ```
   If errors, fix them before proceeding. Do NOT skip.

2. **Pre-flight: Cross-layer field audit**
   For all changed `.ts` files, grep for field names used in API endpoints, plugins, and type definitions. Verify they match across layers. Check that HTML files reference HTTP URLs, not `file://` paths.

3. **Pre-flight: Check Kuro status**
   ```bash
   curl -sf http://localhost:3001/status
   ```
   Note the current cycle count and loop state. If Kuro is mid-cycle, wait for it to finish.

4. **Commit & Push**
   Stage changed files, write a descriptive commit message, and push to main.
   ```bash
   git add <specific-files> && git commit -m "<message>" && git push origin main
   ```

5. **Wait for CI/CD**
   Monitor the GitHub Actions workflow:
   ```bash
   gh run list --limit 1 --json status,conclusion,databaseId
   ```
   Wait until the run completes. If it fails, check logs with `gh run view <id> --log-failed`.

6. **Wait for Kuro to settle (30s)**
   After deployment, Kuro's perception stream will detect workspace changes and may trigger cycles. Wait 30 seconds for the reactive cascade to complete.
   ```bash
   sleep 30 && curl -sf http://localhost:3001/status | jq '{loop: .loop.cycleCount, busy: .claude.busy, mode: .loop.mode}'
   ```

7. **Post-deploy verification**
   Confirm Kuro is healthy and the changes are functional:
   ```bash
   curl -sf http://localhost:3001/health
   curl -sf http://localhost:3001/status | jq .
   ```
   All timestamps in verification output must be labeled as UTC explicitly.

8. **Report**
   Summarize: what was deployed, CI/CD result, Kuro health status (with UTC timestamps), and any issues encountered.
