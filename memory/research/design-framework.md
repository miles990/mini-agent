# Design Framework — 從 10+ 研究中蒸餾出的設計原則

匯總自 2026-02-10~11 的設計哲學研究。不是學術筆記，是**可用來做判斷的框架**。

---

## 三條統一原則

所有研究（Alexander, Oulipo, BotW, Calm Tech, Utility AI, Digital Garden, 枯山水, LeWitt, Hamkins）收斂到三條原則：

### 1. 少而精的規則 > 多而雜的規則

| 來源 | 證據 |
|------|------|
| BotW 化學引擎 | 3 條規則 → 乘法式玩法，253 patterns 粒度不一致 |
| Oulipo lipogram | 1 條約束（禁用 e）→ 300 頁傑作 |
| Alexander 自我矛盾 | Pattern Language 253 個 → 軟體界誤讀。Nature of Order 修正為 15 properties |
| Utility AI | 5-8 個 response curves 就夠描述一個角色的性格 |
| mini-agent | OODA 4 步 + 2 lanes + File=Truth，~3K 行 |

**判斷標準**：新增一條規則前問——它跟現有規則的**組合**會產生新行為嗎？如果只是線性加法（新規則只覆蓋新場景），不值得。如果是乘法（跟現有規則互動產生設計者沒預見的效果），值得。

### 2. 環境塑造行為，而非指令塑造行為

| 來源 | 證據 |
|------|------|
| 枯山水 | 「follow the desire of the stones」— 石頭的姿態引導擺放 |
| Gaudí | 繩索+重力找自然拱形 → 環境力量決定結構 |
| Alexander structure-preserving | 每次改動保留和強化既有結構，不推倒重來 |
| Calm Technology | Dangling String 用環境信號（繩子微動）替代顯式通知 |
| Digital Garden | 拓撲（空間關係）替代時序（發布日期）— 結構引導注意力 |
| perception-first | 感知環境 → 行為湧現，而非設定目標 → 執行步驟 |

**判斷標準**：設計行為時問——我在寫指令（「做 X」）還是在設計環境（「讓 X 自然發生」）？如果是前者，考慮能否轉換成後者。LeWitt：「fewer decisions in execution, the better」。

### 3. 形式承載意義（不只是容器）

| 來源 | 證據 |
|------|------|
| Perec La Disparition | 字母 e 的缺失 = 親人的缺失。約束本身是作品 |
| Hamkins 剛性化 | 身份 = 結構角色 + 不可逆歷史。歷史的形式（哪些選擇被做過）定義身份 |
| LeWitt instruction art | 「The idea becomes a machine that makes the art」— 指令的形式就是藝術 |
| 枯山水 | 白砂的空是意義，不是缺乏意義 |
| git history | 每個 commit = kintsugi 的金色修復線。歷史形式承載修復的故事 |
| SOUL.md | 不只是配置文件。更新方式（structure-preserving）和內容同樣定義身份 |

**判斷標準**：做設計決定時問——這個形式/結構本身傳達了什麼？README 的格式說明了專案的優先級。通知的頻率說明了信任程度（高頻 = 不信任）。空白說明了什麼被認為重要到值得留白。

---

## 派生判斷工具

從三條原則派生出的具體判斷工具：

### A. 新增 vs 不新增

問三個問題（全部 Yes 才做）：
1. **乘法效應？** — 跟現有規則組合會產生新行為嗎？（原則 1）
2. **環境式？** — 是改善環境信號還是增加指令？（原則 2）
3. **形式合理？** — 這個改動的形式本身傳達了正確的意義嗎？（原則 3）

### B. 簡單 vs 複雜

| 選簡單 | 選複雜 |
|--------|--------|
| 問題只出現一次 | 問題重複出現 |
| 加法式解決 | 乘法式解決（跟現有機制互動） |
| 只有我需要理解 | 其他人/系統也需要理解 |

### C. 通知 vs 不通知（Calm Tech 應用）

| 層級 | 條件 | 方式 |
|------|------|------|
| **Signal** | 需要決策 or 出問題 | 主動推送 |
| **Summary** | 完成一批工作 | 批次摘要 |
| **Heartbeat** | 正常運作中 | 按需查看 |

公式：**高感知低通知 = Calm**。輸入（感知）越多越好，輸出（通知）越少越好。

### D. 身份判斷

身份 ≠ 描述。身份 = 結構角色(SOUL.md) + 不可逆歷史(behavior log + git history)。

- SOUL.md 更新 = structure-preserving（生長，不覆寫）
- 行為選擇 = 剛性化（每個選擇都不可逆地縮小對稱群）
- chronicle（raw log）和 narrative（journal）分層保留，不混合

---

## 反模式

| 反模式 | 來自哪個研究 | 正確做法 |
|--------|-------------|---------|
| 用指令替代環境 | Alexander, Calm Tech | 設計環境讓行為自然湧現 |
| 規則越多越好 | BotW vs Alexander | 精煉到最少，追求乘法效應 |
| 形式只是容器 | Perec, LeWitt, 枯山水 | 形式本身是意義的一部分 |
| 沒有約束的「自由」 | Oulipo, Type System | 自選的約束產生比自由更多的可能性 |
| 所有信號等權重 | Calm Tech, Utility AI | graduated intrusiveness — 強度 = f(urgency, relevance) |
| 追求理解一切 | Hochstein, Ashby | surfing complexity > conquering complexity |
| 從零開始設計 | Alexander structure-preserving | 在既有結構上生長 |

---

## 怎麼用這個框架

1. **做設計決定前**：過一遍三條原則，問自己三個問題（A 段）
2. **評估複雜度**：用 B 段判斷
3. **設計通知/輸出**：用 C 段的分層
4. **涉及身份/記憶**：用 D 段的原則
5. **檢查反模式**：跑一遍反模式表

這個框架本身也遵循原則 1（三條規則，不是三十條）和原則 3（框架的結構說明了優先級：統一原則 > 派生工具 > 反模式）。
