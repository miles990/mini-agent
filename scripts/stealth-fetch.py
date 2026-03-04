#!/usr/bin/env -S uv run --quiet
# /// script
# dependencies = ["httpx[http2]", "certifi"]
# requires-python = ">=3.10"
# ///
"""
Stealth HTTP Fetcher — Scrapling-inspired anti-detection layer.

Mimics real browser fingerprints at the HTTP level:
- Rotating User-Agent + matching Sec-CH-UA headers
- HTTP/2 with proper header ordering
- Cloudflare challenge detection
- Auto-retry with different profiles on bot detection

Usage:
  uv run scripts/stealth-fetch.py <url>
  uv run scripts/stealth-fetch.py <url> --json     # JSON output with metadata
  uv run scripts/stealth-fetch.py <url> --check     # Just check if accessible (exit code)
"""

import sys
import json
import hashlib
import re
from datetime import datetime, timezone

import ssl
import certifi
import httpx

# ─── Browser Fingerprint Profiles ────────────────────────────────────────────
# Each profile is a consistent set of headers that match a real browser.
# Inconsistency between UA and Sec-CH-UA is a common detection signal.

PROFILES = [
    {
        "name": "chrome-mac",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"macOS"',
    },
    {
        "name": "chrome-win",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"Windows"',
    },
    {
        "name": "firefox-mac",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
        # Firefox doesn't send Sec-CH-UA
    },
    {
        "name": "safari-mac",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
        # Safari doesn't send Sec-CH-UA
    },
]

# Common headers that all real browsers send
BASE_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ja;q=0.8,zh-TW;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}

# ─── Bot Detection Signals ───────────────────────────────────────────────────

# Cloudflare challenge page markers
CF_MARKERS = [
    "cf-browser-verification",
    "cf_chl_opt",
    "challenge-platform",
    "jschl_vc",
    "jschl_answer",
    "ray id",
    "checking your browser",
    "enable javascript and cookies",
    "attention required",
    "just a moment",
    "cloudflare",
    "please wait while we verify",
]

# Generic bot detection markers
BOT_MARKERS = [
    "access denied",
    "bot detected",
    "automated access",
    "please verify you are human",
    "captcha",
    "are you a robot",
    "unusual traffic",
    "rate limit exceeded",
]

# Auth-required markers (not a bot block, but can't fetch content)
AUTH_MARKERS = [
    "sign in",
    "log in",
    "login",
    "create an account",
    "register to continue",
]


def detect_block_type(content: str, status_code: int) -> str | None:
    """Detect if response indicates bot blocking, auth requirement, or clean pass."""
    lower = content[:3000].lower()

    if status_code == 403:
        # Check if it's CF specifically
        for m in CF_MARKERS:
            if m in lower:
                return "cloudflare"
        return "blocked-403"

    if status_code == 429:
        return "rate-limited"

    if status_code == 503:
        for m in CF_MARKERS:
            if m in lower:
                return "cloudflare"
        return "service-unavailable"

    # Check content for bot detection signals
    cf_hits = sum(1 for m in CF_MARKERS if m in lower)
    if cf_hits >= 2:
        return "cloudflare"

    bot_hits = sum(1 for m in BOT_MARKERS if m in lower)
    if bot_hits >= 2:
        return "bot-detected"

    # Check content quality (very short HTML = likely blocked)
    if status_code == 200 and len(content) < 500:
        if "<html" in lower and ("captcha" in lower or "challenge" in lower):
            return "challenge-page"

    return None


def extract_text(html: str) -> str:
    """Simple HTML to text extraction — remove scripts, styles, tags."""
    # Remove script and style blocks
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
    # Remove HTML comments
    text = re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL)
    # Remove tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Decode common entities
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = text.replace('&quot;', '"').replace('&#39;', "'").replace('&nbsp;', ' ')
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def extract_title(html: str) -> str:
    """Extract <title> from HTML."""
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else ""


def stealth_fetch(url: str, profile_idx: int = 0, timeout: float = 12.0) -> dict:
    """Fetch URL with stealth headers. Returns dict with content + metadata."""
    profile = PROFILES[profile_idx % len(PROFILES)]

    headers = {**BASE_HEADERS}
    for k, v in profile.items():
        if k != "name":
            headers[k] = v

    result = {
        "url": url,
        "profile": profile["name"],
        "ts": datetime.now(timezone.utc).isoformat(),
    }

    try:
        # Use certifi bundle for SSL (macOS + VPN compatibility)
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        with httpx.Client(
            http2=True,
            follow_redirects=True,
            timeout=timeout,
            verify=ssl_ctx,
        ) as client:
            resp = client.get(url, headers=headers)

            result["status"] = resp.status_code
            result["content_length"] = len(resp.text)
            result["final_url"] = str(resp.url)

            # Check for bot blocking
            block_type = detect_block_type(resp.text, resp.status_code)
            if block_type:
                result["blocked"] = block_type
                result["content"] = ""
                return result

            # Extract content
            content_type = resp.headers.get("content-type", "")
            if "html" in content_type or resp.text.strip().startswith("<!") or resp.text.strip().startswith("<html"):
                result["title"] = extract_title(resp.text)
                result["content"] = extract_text(resp.text)
                result["format"] = "html"
            else:
                result["content"] = resp.text[:50000]
                result["format"] = "text"

            return result

    except httpx.TimeoutException:
        result["error"] = "timeout"
        result["content"] = ""
        return result
    except httpx.ConnectError as e:
        result["error"] = f"connect: {e}"
        result["content"] = ""
        return result
    except Exception as e:
        result["error"] = str(e)
        result["content"] = ""
        return result


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        sys.exit(0)

    url = sys.argv[1]
    json_mode = "--json" in sys.argv
    check_mode = "--check" in sys.argv

    # Try up to 3 profiles on bot detection
    for attempt in range(3):
        result = stealth_fetch(url, profile_idx=attempt)

        if result.get("blocked"):
            if attempt < 2:
                continue  # Retry with different profile
            # All profiles blocked
            if json_mode:
                print(json.dumps(result, ensure_ascii=False))
            elif check_mode:
                sys.exit(1)
            else:
                print(f"BLOCKED:{result['blocked']}")
            sys.exit(1)

        if result.get("error"):
            if json_mode:
                print(json.dumps(result, ensure_ascii=False))
            elif check_mode:
                sys.exit(1)
            else:
                print(f"ERROR:{result['error']}")
            sys.exit(1)

        # Success
        if json_mode:
            print(json.dumps(result, ensure_ascii=False))
        elif check_mode:
            sys.exit(0)
        else:
            # Human-readable output
            if result.get("title"):
                print(result["title"])
            content = result.get("content", "")
            if content:
                print(content[:8000])
            else:
                print("(empty content)")
        sys.exit(0)

    # Should not reach here
    sys.exit(1)


if __name__ == "__main__":
    main()
