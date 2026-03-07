#!/usr/bin/env -S uv run --quiet
# /// script
# dependencies = ["trafilatura>=2.0", "httpx[http2]"]
# requires-python = ">=3.10"
# ///
"""
Trafilatura-based content extractor — Layer 1b fallback.

Extracts main content from HTML/URL, outputs clean text optimized for LLM consumption.
Handles boilerplate removal (nav, footer, sidebar, ads) better than regex.

Usage:
  echo "<html>..." | uv run scripts/extract-content-py.py
  uv run scripts/extract-content-py.py --url https://example.com
  uv run scripts/extract-content-py.py --url https://example.com --json
"""

import sys
import json

import trafilatura
import httpx

def extract_from_html(html: str, url: str = "") -> dict:
    """Extract main content from HTML string."""
    result = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=True,
        include_links=False,
        include_images=False,
        favor_precision=True,
        output_format="txt",
    )

    title = trafilatura.extract(
        html,
        url=url,
        output_format="xml",
        include_comments=False,
    )
    # Extract title from XML output
    extracted_title = ""
    if title:
        import re
        m = re.search(r'title="([^"]*)"', title)
        if m:
            extracted_title = m.group(1)

    return {
        "title": extracted_title,
        "content": result or "",
        "length": len(result) if result else 0,
    }


def fetch_and_extract(url: str) -> dict:
    """Fetch URL and extract content."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        with httpx.Client(http2=True, follow_redirects=True, timeout=12.0, verify=False) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code != 200:
                return {"title": "", "content": "", "length": 0, "error": f"HTTP {resp.status_code}"}
            return extract_from_html(resp.text, url)
    except Exception as e:
        return {"title": "", "content": "", "length": 0, "error": str(e)}


def main():
    args = sys.argv[1:]
    json_mode = "--json" in args
    url_idx = args.index("--url") if "--url" in args else -1

    if url_idx >= 0 and url_idx + 1 < len(args):
        url = args[url_idx + 1]
        result = fetch_and_extract(url)
    else:
        # Read HTML from stdin
        html = sys.stdin.read()
        if not html or len(html) < 50:
            if json_mode:
                print(json.dumps({"title": "", "content": "", "length": 0}))
            sys.exit(1)
        url = ""
        for a in args:
            if not a.startswith("--"):
                url = a
                break
        result = extract_from_html(html, url)

    if json_mode:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(result.get("title", ""))
        print(result.get("content", ""))

    sys.exit(0 if result.get("content") else 1)


if __name__ == "__main__":
    main()
