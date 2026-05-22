---
name: health-sweep
description: Run all mini-agent health-check and janitor scripts in one pass and summarize the results. Use when the user wants a project health check or types /health-sweep.
disable-model-invocation: true
---

# health-sweep

一鍵執行 mini-agent 所有健康檢查與 janitor 腳本，彙整成一份報告。

`package.json` 裡的健康檢查指令散落各處，這個 skill 把它們收攏成單一入口。
全部用 `tsx` 直接跑 `.ts`，**不需要先 `pnpm build`**。

## 步驟

1. 依序執行下列指令（每個都用 Bash，`cd` 到 `$CLAUDE_PROJECT_DIR`）。
   janitor 全部跑 **dry-run**（不加 `--apply`），只報告不動檔案：

   | # | 指令 | 檢查項目 |
   |---|------|---------|
   | 1 | `pnpm check:autonomy-closure` | OODA 自主收斂健康度 |
   | 2 | `pnpm check:test-health` | 測試套件健康度 |
   | 3 | `pnpm check:design-governance` | 設計治理規範 |
   | 4 | `pnpm check:pr-lifecycle` | PR 生命週期 |
   | 5 | `pnpm check:runtime-workspace` | runtime workspace 狀態 |
   | 6 | `pnpm guard:issue-evidence` | issue 證據門檻 |
   | 7 | `pnpm janitor:workspaces` | 殘留 worktree（dry-run）|
   | 8 | `pnpm janitor:stash` | 殘留 stash（dry-run）|
   | 9 | `pnpm typecheck` | TypeScript strict 型別 |

2. 某個指令失敗或不存在時不要中斷 —— 記下來，繼續跑下一個。

3. 全部跑完後輸出一張總表：

   ```
   | 檢查 | 結果 | 摘要 |
   |------|------|------|
   | autonomy-closure | ✅ / ⚠️ / ❌ | 一行重點 |
   ...
   ```

   最後列出**需要處理的項目**（⚠️ / ❌），各附一句建議的下一步動作。

## 注意

- 這是唯讀巡檢。要真的清理時，janitor 改用 `pnpm janitor:workspaces:apply` /
  `pnpm janitor:stash:apply`，且須先向使用者確認。
- 跑之前先確認 Kuro 狀態：`curl -sf localhost:3001/status`。若 cycle 進行中，
  檢查腳本仍可安全執行（皆唯讀），但要留意輸出可能反映變動中的狀態。
