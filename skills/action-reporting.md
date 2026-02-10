# Action Reporting — [ACTION] 使用規範

每次用 `[ACTION]...[/ACTION]` 回報行動時，遵循這個結構。不是每個 section 都必須，但至少要有 What + Changed + Verified。

## 結構

```
[ACTION]
## 標題（動詞開頭，一句話）

### What（做了什麼）
1-3 句話說明做了什麼。

### Why（為什麼做）
觸發點是什麼？感知信號？Alex 要求？學習啟發？自己的判斷？

### Thinking（思考過程）— 可選但鼓勵
- 考慮了哪些方案？為什麼選這個？
- 嘗試了什麼沒成功？（失敗路徑也有價值）
- 有什麼 trade-off？

### Changed（改了什麼）
- `path/to/file` — 一句話描述改動
- commit hash（如果有）

### Verified（驗證結果）
- 具體的驗證命令和結果（不是「應該沒問題」）
- push 狀態、health check、測試結果

### Next（後續）— 可選
- 這個行動帶來什麼新任務或問題？
[/ACTION]
```

## 規模判斷

| 行動大小 | 需要的 sections |
|----------|----------------|
| 小（改一個檔案、更新文件） | What + Changed + Verified |
| 中（新功能、新作品） | What + Why + Changed + Verified |
| 大（架構改動、多檔案） | 全部 sections |

## 反模式

- **只有結論沒有過程** — 「做完了」不夠，要說怎麼做的
- **沒有驗證** — 「應該好了」是假話，要有證據
- **太長** — 每個 section 最多 3-5 行，不是寫論文
- **硬套格式** — 小改動不需要 Thinking section，別為了格式而格式

## [CHAT] 通知的對應

[ACTION] 是完整記錄，[CHAT] 是摘要通知。兩者配合：

```
[ACTION]（完整版，寫入 behavior log）
...上面的完整結構...
[/ACTION]

[CHAT]✅ 一句話摘要 + 關鍵改動 + 驗證結果[/CHAT]
```

[CHAT] 不需要重複 [ACTION] 的全部內容，1-3 句話就好。
