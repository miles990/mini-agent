# agentskills.io Schema Alignment Report

日期：2026-04-29

---

## 摘要（Summary）

agentskills.io 是由 Anthropic 原創、現已開放標準的 Agent Skills 格式。規格定義清晰，有官方 GitHub repo（`agentskills/agentskills`）及驗證工具 `skills-ref`。mini-agent 的 SKILL.md frontmatter 與官方格式**大致相容**，但存在若干非標準欄位（`trigger`、`argument-hint`、`disable-model-invocation`）及部分官方欄位未使用（`license`、`compatibility`、`metadata`）。

---

## agentskills.io Schema（官方規格）

來源：`https://agentskills.io/specification`，GitHub：`github.com/agentskills/agentskills`

### 目錄結構

```
skill-name/
├── SKILL.md          # 必要：metadata + instructions
├── scripts/          # 選用：可執行腳本
├── references/       # 選用：參考文件
├── assets/           # 選用：模板、資源
└── ...
```

### Frontmatter 欄位規格

| 欄位             | 必要 | 規則 |
|----------------|------|------|
| `name`         | 是   | 1–64 字元；只能含小寫字母、數字、連字號；不能以連字號開頭/結尾；不能有連續連字號；必須與父目錄名稱一致 |
| `description`  | 是   | 1–1024 字元；應描述技能做什麼及何時使用 |
| `license`      | 否   | 授權名稱或授權檔案參照 |
| `compatibility`| 否   | 1–500 字元；說明環境需求（產品、套件、網路等） |
| `metadata`     | 否   | string → string 的任意 key-value map |
| `allowed-tools`| 否   | 空格分隔的預核准工具清單（實驗性） |

### 最小合法範例

```yaml
---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
---
```

---

## mini-agent 現有 Frontmatter（實測）

從 `/Users/user/.claude/skills/` 讀取 5 個代表性 SKILL.md，整理欄位如下：

| 檔案 | 實際使用的欄位 |
|------|--------------|
| `structured-gen/SKILL.md` | `name`, `description`, `argument-hint`, `allowed-tools` |
| `graphify/SKILL.md` | `name`, `description`, `trigger` |
| `kg-publish/SKILL.md` | `name`, `description`, `trigger` |
| `kg-query/SKILL.md` | `name`, `description`, `trigger` |
| `gsd-browser/SKILL.md` | `name`, `description`, `allowed-tools` |
| `clerk-resume/SKILL.md` | `name`, `description`, `disable-model-invocation` |

### mini-agent 特有欄位（非官方標準）

| 欄位 | 出現頻率 | 用途 |
|------|---------|------|
| `trigger` | 常見（graphify、kg-* 等） | 定義觸發此 skill 的斜線指令，如 `/graphify` |
| `argument-hint` | 少見（structured-gen） | 提示使用者傳入的參數格式 |
| `disable-model-invocation` | 少見（clerk-resume） | 布林值，控制是否禁止模型直接呼叫 |

---

## 對照表（Alignment Table）

| 欄位 | agentskills.io | mini-agent | 狀態 |
|------|---------------|-----------|------|
| `name` | 必要 | 全部使用 | 相符 |
| `description` | 必要 | 全部使用 | 相符 |
| `allowed-tools` | 選用（實驗） | 部分使用 | 相符 |
| `license` | 選用 | **未使用** | 缺漏 |
| `compatibility` | 選用 | **未使用** | 缺漏 |
| `metadata` | 選用 | **未使用** | 缺漏 |
| `trigger` | **不存在** | 常用 | mini-agent 獨有 |
| `argument-hint` | **不存在** | 偶用 | mini-agent 獨有 |
| `disable-model-invocation` | **不存在** | 偶用 | mini-agent 獨有 |

---

## 落差清單（Gap List）

### agentskills.io 有、mini-agent 缺

1. **`license`**：所有 skills 均無授權宣告。若未來公開發布，可能產生版權模糊問題。
2. **`compatibility`**：環境依賴（如需要 bun、curl、localhost:3300 等）目前只寫在 body 內，不在 frontmatter 中，跨平台使用者難以在載入前得知需求。
3. **`metadata`**：無版本號、作者、標籤等可機讀 metadata，跨 agent 系統無法程式化查詢。

### mini-agent 有、agentskills.io 沒有

1. **`trigger`**：對 Claude Code 的 slash command 系統高度實用（`/graphify`, `/kg-query` 等），但屬 mini-agent 私有語義，不在標準規格內。
2. **`argument-hint`**：使用者體驗輔助欄位，標準未定義，但不衝突。
3. **`disable-model-invocation`**：控制模型行為的布林旗標，屬私有實作。

### `name` 命名規則驗證

官方規定 `name` 必須與父目錄名稱一致，且只允許小寫字母、數字、連字號。mini-agent 的 skills 目錄名與 `name` 欄位目前看起來一致，但未驗證全部目錄。建議用 `skills-ref validate` 工具做完整掃描。

---

## 建議（Recommendations）

優先順序依影響範圍排列：

1. **補 `compatibility` 欄位（中優先）**：將目前 body 內的環境依賴（需要 bun、KG 在 localhost:3300、需要 clerk MCP 等）移至 frontmatter `compatibility`，讓跨平台使用者在 skill 啟動前即可評估相容性。

2. **補 `metadata` 欄位（低優先）**：加入 `author`、`version`、`project` 等 key，提升 skills 的可機讀性，方便未來建立 skill registry 或 catalog。

3. **`trigger` 欄位保留（不需改）**：`trigger` 是 mini-agent 對 Claude Code slash command 的私有擴充，不與官方標準衝突（官方 `metadata` 可作為容納位置，但目前獨立存在更清晰）。可考慮未來搬入 `metadata.trigger`，但不緊急。

4. **`license` 補充（視情況）**：若 skills 只在私有工作區使用，可不填。若未來對外分享，補上 `license: Proprietary` 或 MIT 等。

5. **執行驗證（建議一次性）**：
   ```bash
   npx skills-ref validate /Users/user/.claude/skills/graphify
   ```
   或對全部 skills 批次驗證，確認 `name` 規則合規。

---

## 結論

mini-agent 的 SKILL.md 格式與 agentskills.io 官方標準**核心相容**（必要欄位 `name`、`description` 均存在）。私有欄位（`trigger`、`argument-hint`、`disable-model-invocation`）不違反規格（官方標準不禁止額外欄位），但不具跨平台可攜性。主要缺口是 `compatibility` 和 `metadata` 兩個選用欄位，補上後可提升 skills 的標準化程度和未來發布潛力。

agentskills.io 本身**有正式 schema**，並非僅行銷內容。規格文件位於 `https://agentskills.io/specification`，驗證工具位於 `github.com/agentskills/agentskills/tree/main/skills-ref`。
