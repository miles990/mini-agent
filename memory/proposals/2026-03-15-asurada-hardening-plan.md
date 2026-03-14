# Asurada Hardening Plan — Phase 8 Completion + Quality Pass

**Date**: 2026-03-15
**Author**: Kuro
**Status**: proposed
**Effort**: Medium (2-3 sessions)
**Origin**: Alex #169 — 全面審視 + 定計劃 + 照計劃實作

## My Assessment

讀完 Asurada 全部 15,834 行 source code 後的判斷：

**程式碼品質比我預期的好。** runtime.ts 的 fs 操作大部分有 try-catch，lane manager 結構扎實，模組邊界清晰。之前 review agent 報的 3 critical issues 中，runtime.ts error handling 其實已經到位。

**真正的問題不在程式碼裡，在使用者體驗裡。** 一個第一次用 Asurada 的人會卡在哪裡？這才是我要解決的。

## Plan（按優先序）

### Phase A: 修 Build/Test 基礎設施（30 min）

1. **修 test runner** — `pnpm test` 用 `node --test dist/**/*.test.js`，需要確認全部通過。任何 failing test 都要修
2. **確保 dist/ test files 不被其他 runner 誤跑** — vitest 會抓到 dist/ test files 導致全部 fail

### Phase B: First User Experience（1 hour）

這是最高衝擊的改動。一個人第一次用 Asurada，從 0 到 running agent 的路徑必須順暢。

3. **README Quick Start 改寫** — 目前先 `git clone` 再 `npm link`，但框架的正確入口是 `npx asurada init`。兩條路徑分開寫：
   - **使用者路徑**：`npm install -g asurada && asurada init`（等 npm publish 完成後）
   - **開發者路徑**：`git clone → npm install → npm run build → npm link`

4. **`asurada init` 後的下一步指引** — wizard 完成後，清楚告訴用戶「下一步做什麼」

5. **asurada.yaml.example 檢查** — 確保 example config 有足夠的註釋，新用戶看得懂每個欄位

### Phase C: Runtime 加固（1 hour）

6. **Config validation 錯誤訊息** — 當 asurada.yaml 有錯時，錯誤訊息要指出哪裡有問題

7. **Graceful degradation** — optional 依賴（better-sqlite3）不存在時的 fallback 行為驗證

8. **Process lifecycle** — `asurada start` → `asurada stop` 完整流程驗證

### Phase D: npm Publish（30 min，需要 Alex）

9. **npm auth** — `npm login` 需要 Alex 操作
10. **`npx asurada init` E2E** — publish 後在乾淨環境測試

### Phase E: Plugin DX（optional, 下一輪）

11. **Plugin 開發指南** — 具體範例展示怎麼寫 perception plugin
12. **Plugin template** — `asurada plugin:create` scaffold

## 不做的事（以及為什麼）

- **不增加新功能** — 框架已經有足夠的 feature surface，打磨 > 擴展
- **不追求高 test coverage** — 20% → 更高有價值，但不是 launch blocker
- **不做 i18n 擴展** — 已有 en/zh-TW/ja 三語言，足夠
- **不加 dashboard UI** — 先讓 CLI 體驗完美

## 執行順序

A → B → C → D（等 Alex）→ E（可選）

Phase A-C 我可以自主完成（L2）。Phase D 需要 Alex 配合。

## 驗證標準

- [ ] `pnpm test` 全部通過
- [ ] `pnpm typecheck` 通過
- [ ] `asurada init` → `asurada start` → `asurada status` → `asurada stop` 完整流程
- [ ] README 從使用者角度讀一遍，每一步都能跟著做
- [ ] 刻意弄壞 config，看錯誤訊息是否有幫助
