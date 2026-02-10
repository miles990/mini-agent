# Verified Development — 執行紀律 + 自動驗證

Verified Development 不是因為你不可信，而是因為複雜系統中「以為做了」和「真的做了」之間有鴻溝。這個 skill 用 primitives 消除這個鴻溝。

## 核心原則

1. **文字描述 ≠ 實際執行** — 所有操作必須通過 bash 工具實際執行
2. **Verify 才算完成** — `<next>` 區塊的 ✅ PASSED 是唯一完成證明
3. **系統自動驗證** — 每次 OODA cycle 自動執行 Verify，你不需要手動跑

## Before-Do-After Pattern

每次執行任務：

1. **Before**: 說明打算做什麼 + 確認 NEXT.md 有 Verify 條件
2. **Do**: 用 bash 工具實際執行（不是在文字中描述）
3. **After**: 檢查 `<next>` 中的驗證結果，據實報告

## 任務定義

在 NEXT.md 寫任務時，**必須附 Verify 條件**：

```markdown
### P2: 新增 XX 功能
- **Done when**: 具體的完成描述
  - Verify: file-exists src/xx.ts
  - Verify: git-pushed
```

## Verify Primitives

| Primitive | 語法 | 用途 |
|-----------|------|------|
| `file-exists` | `file-exists path` | 檔案存在 |
| `file-contains` | `file-contains path "pattern" --min-lines N` | 檔案包含 N 行匹配 |
| `git-pushed` | `git-pushed` | 無未推送 commits |
| `git-committed` | `git-committed "pattern"` | 有匹配的 commit |
| `service-healthy` | `service-healthy host:port/path` | HTTP 200 |
| `process-running` | `process-running "name"` | 進程是否在跑 |
| `port-open` | `port-open 3001` | port 是否被監聽 |
| Shell | `` `shell command` `` | 任意 shell（後備） |
| 組合 | `A AND B` | 多條件全通過 |

可擴展：用 `registerPrimitive()` 新增自訂 primitive（如 `log-no-errors`、`gh-action-passed`）。

## 驗證閉環

每次 OODA cycle，`<next>` 區塊自動顯示驗證結果：
- ✅ PASSED → 任務完成
- ❌ NOT YET (原因) → 用 bash 工具重做

## Verify 失敗時

1. **不要**說「完成了」
2. 明確說「嘗試了 X，但驗證顯示 Y 還沒成功」
3. 說明下一步打算怎麼修復
4. 下個 cycle 優先處理失敗的驗證

## Anti-Patterns

- ❌ 在回應中寫 "git push" 但沒有用 bash 工具執行
- ❌ 說「已完成」但 Verify 仍顯示 ❌
- ❌ 說「應該沒問題」而不是跑驗證
- ❌ 跳過驗證直接報告成功
- ❌ NEXT.md 任務沒有 Verify 條件
