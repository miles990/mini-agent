---
name: coordinate-edit
description: Pre-edit coordination ritual for the shared mini-agent tree — checks Kuro's cycle state, current branch, and whether worktree isolation is needed before touching src/ or memory/. Use before editing src/ or memory/ in the mini-agent repo.
---

# coordinate-edit

mini-agent 的工作樹由 Kuro 和 Claude Code 共同編輯。CLAUDE.md 的
「Concurrent Work / Pre-Action Checks」要求動手前先協調 —— 這個 skill
把那套儀式收成一個指令，避免每次手動漏步驟。

## 何時用

- 即將編輯 `src/` 或 `memory/`（Kuro 的感知會對檔案改動反應）
- 不確定現在動手會不會撞到 Kuro 的 active cycle
- 開始一項可能 >3 files 或 >50 lines 的改動

## 用法

```
bash .claude/skills/coordinate-edit/coordinate.sh
bash .claude/skills/coordinate-edit/coordinate.sh --announce "我要改 X 檔案"
```

不帶參數 = 唯讀檢查（Kuro cycle 狀態、目前分支、是否需要 worktree）。
帶 `--announce "<訊息>"` = 同時在 chat-room 發出佔用宣告。

## 檢查內容

1. **Kuro 狀態** — `GET localhost:3001/status`。若 `busy` 為真，代表
   active cycle 進行中，改 `src/` / `memory/` 前務必先宣告。
2. **目前分支** — 若在 `runtime/main`，tracked 改動會被 runtime
   autocorrect 洗掉，必須改走 `forge-lite.sh` worktree。
3. **宣告**（`--announce`）— 在 chat-room POST 佔用訊息。衝突時，
   先宣告者優先（CLAUDE.md）。
4. **動手前清單** — 宣告、worktree 門檻、runtime/main 禁 commit。

## 之後

大改動走 `scripts/forge-lite.sh create <name>` → 改動 →
`forge-lite.sh yolo <worktree> "msg"`（verify + push + PR）。
宣稱完成前用 `persist-check` skill 確認已 commit + push + PR。
