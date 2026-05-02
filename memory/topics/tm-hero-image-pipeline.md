# tm-hero-image-pipeline

- [2026-05-02] 2026-05-02T08:48Z TM hero image patch 第一步交付：scripts/gen-hero-refs.mjs 寫好＋跑通。OpenAI gpt-image-1 帳號 billing hard limit reached → fallback xAI grok-imagine-image (XAI_API_KEY 兩個 .env 都有)。3 styles for "Photosynthesis": warm-flat (159KB) / isometric-tech (137KB) / painterly-storybook (235KB)，all 1024x768，存於 teaching-monster/output/hero-refs/。Static served at http://localhost:3456/output/hero-refs/*.png (HTTP 200 verified)。Alex 沒授權 src/ pipeline patch 之前先停在 reference 階段等選 style anchor。下一步 Alex 選完 styl
- [2026-05-02] 2026-05-02T08:58Z step 2 交付（純 add）：`teaching-monster/src/hero-image.mjs` 寫好。export `generateHeroImage(merged, plan, {topicTitle, studentPersona})` → 呼 xAI grok-imagine-image (HERO_IMAGE_PROVIDER env override) → b64 PNG → 包成 SVG `<image href="data:image/png;base64,...">` 字串。**Drop-in compat**：return SVG string，與既有 `_heroSvgCode` consumer 同型，但內容是 image-svg 非 drawsvg-python。Style anchor 寫死 painterly-storybook (Alex P1)。下 cycle wire-in：(1) generate-script.mjs:2759 `generateHeroCode` 內部加 try `generat
- [2026-05-02] 2026-05-02T09:06Z TM hero image pipeline live-patched + verified.

**Patches applied (3 src files, 14 lines added)**:
1. `teaching-monster/src/generate-script.mjs:12` — `import { generateHeroImage } from "./hero-image.mjs"`
2. `teaching-monster/src/generate-script.mjs:3606-3611` — `_heroPromise` 改 image API 優先 + drawsvg fallback
3. `teaching-monster/src/generate-slides.mjs:2915-2921` — detect `_heroSvgCode` 已是 `<svg`/`<?xml` → 跳過 python exec 直接用

**Live smoke-test verified**：set -a; source .env
