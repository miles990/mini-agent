#!/usr/bin/env python3
"""
browser-use runner for mini-agent delegation.

Reads a task prompt from stdin, runs browser-use Agent with ChatClaudeCLI,
outputs JSON result to stdout. Designed to be spawned by delegation.ts.

Exit codes:
  0 — success (result in stdout JSON)
  1 — agent error
  2 — 2FA/manual intervention needed (status in stdout JSON)
"""

import asyncio
import json
import os
import sys
import logging

# Suppress noisy logs from browser-use internals
logging.basicConfig(level=logging.WARNING)

# Add scripts/ dir to path so chat_claude_cli is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chat_claude_cli import ChatClaudeCLI
from browser_use import Agent, Browser


def build_credentials_context() -> str:
    """Build credentials context string from environment variables."""
    creds = []

    if os.getenv("GOOGLE_EMAIL"):
        creds.append(f"Google account: {os.getenv('GOOGLE_EMAIL')} / password: {os.getenv('GOOGLE_PASSWORD')}")

    if os.getenv("GITHUB_USERNAME"):
        creds.append(f"GitHub account: {os.getenv('GITHUB_USERNAME')} / password: {os.getenv('GITHUB_PASSWORD')}")

    if os.getenv("TM_EMAIL"):
        creds.append(f"Teaching Monster account: {os.getenv('TM_EMAIL')} / password: {os.getenv('TM_PASSWORD')}")

    if not creds:
        return ""

    return (
        "\n\nAvailable credentials (use only when login is required):\n"
        + "\n".join(f"- {c}" for c in creds)
        + "\n\nLogin guidelines:\n"
        "1. Prefer OAuth buttons ('Sign in with Google/GitHub') if available\n"
        "2. If you encounter 2FA/OTP, STOP and output: {\"status\": \"needs_2fa\", \"service\": \"<name>\"}\n"
        "3. If you encounter CAPTCHA, STOP and output: {\"status\": \"needs_captcha\"}\n"
        "4. Never attempt to bypass security measures\n"
    )


async def main() -> None:
    task = sys.stdin.read().strip()
    if not task:
        json.dump({"status": "error", "error": "Empty task"}, sys.stdout)
        sys.exit(1)

    # Append credentials context if any env vars are set
    creds_context = build_credentials_context()
    full_task = task + creds_context

    # Connect to existing Chrome via CDP (port from env, default 9222)
    cdp_port = int(os.getenv("CDP_PORT", "9222"))
    cdp_host = os.getenv("CDP_HOST", "localhost")
    cdp_url = f"http://{cdp_host}:{cdp_port}"

    llm = ChatClaudeCLI(
        model=os.getenv("BROWSE_MODEL", "claude-sonnet-4-6"),
        timeout_seconds=120,
        max_turns=1,
    )

    browser = Browser(cdp_url=cdp_url, headless=False)

    try:
        agent = Agent(
            task=full_task,
            llm=llm,
            browser=browser,
            max_actions_per_step=5,
        )

        result = await agent.run(max_steps=20)

        # Extract final result
        final_text = ""
        if result and hasattr(result, "final_result"):
            final_text = result.final_result() or ""
        elif result:
            final_text = str(result)

        # Check for 2FA/manual intervention signals in output
        if any(signal in final_text.lower() for signal in ["needs_2fa", "needs_captcha", "manual verification"]):
            json.dump({"status": "needs_manual", "detail": final_text}, sys.stdout)
            sys.exit(2)

        json.dump({"status": "ok", "result": final_text}, sys.stdout)

    except Exception as e:
        json.dump({"status": "error", "error": str(e)}, sys.stdout)
        sys.exit(1)

    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
