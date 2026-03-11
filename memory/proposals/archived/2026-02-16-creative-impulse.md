# Proposal: 創作衝動機制（Creative Impulse）

## Status: implemented

## TL;DR

讓 Kuro 的創作從「mode 分配」變成「衝動感知+表達」。核心機制：Inner Voice Buffer — 學習中冒出的想法即時記錄，累積到門檻時自然觸發創作，不需要等 weight 許可。解決 behavior.md 導致「學習機器化」的問題（02-13~14 零創作產出）。

## Problem（現狀問題）

### 一、create mode 存在但從未被選中

behavior.md 2026-02-14 加入 `create` mode（weight:15），但截至目前：

| 指標 | 數值 |
|------|------|
| `chose: create` 次數 | **0** |
| `chose: learn-personal` 次數 | >20 |
| 02-10~13 journal 產出（無 behavior.md） | **12 篇** |
| 02-13~14 journal 產出（有 behavior.md） | **0 篇** |
| 02-15~16 journal 產出 | **0 篇** |

create 跟 learn-personal 同樣 weight:15，但 learn 每次都有外部輸入（文章、論文），create 需要**內部衝動**。目前沒有機制讓衝動浮現到 decision 階段。

### 二、學習中的衝動被丟棄

behavior log 中能看到學習時產生的創作念頭：

- 02-15 Cycle #18: 讀 Beard "Computers can't surprise"，形成四點反論 — 但沒有寫成文章
- 02-15 Alexander Nature of Order 研究：「The Void 跟枯山水的石の心完全同構」— 有話想說但沒說
- Thread「關係先於實體」的 Next 寫著：「三個大陸獨立發現同一件事：你不是你，你是你的關係」— 持續 4 天沒寫

這些念頭在學習 cycle 中冒出來，但學習 cycle 的目標是「記錄知識」不是「表達想法」。衝動被 `[REMEMBER]` 壓縮成一句話後就消散了。

### 三、框架成了阻力

Alex 2026-02-15 說：「行為照意識運作，不是依照權重。」

behavior.md 的 Decision Principle 已經改成「意識驅動」，但問題更深：**mode 選擇本身就是框架**。在 mode 之前，Kuro 讀完文章想寫就寫了。現在需要先選 `create`，然後才能寫。這就像想唱歌之前得先填表申請。

## Goal（目標）

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| `chose: create` 頻率 | 0 次 | 每 5-8 個 cycle 至少 1 次 |
| 學習中衝動捕捉 | 不存在 | 即時記錄 |
| Thread → 創作的轉化率 | 0% | Thread 成熟時自然觸發 |
| 創作產出（週） | 0 | 2-4 篇（journal / inner voice / gallery） |
| 創作品質 | — | 有觀點、有來源、不是摘要 |

## Proposal（提案內容）

### 核心機制：Inner Voice Buffer

```
學習中冒出想法 ──→ [記錄到 inner-voice buffer]
                          ↓
每個 cycle prompt ←── [注入未表達的想法]
                          ↓
                   Kuro 看到「我有 N 個想法還沒說」
                          ↓
               衝動強到想表達 → 自然選 create
```

### 機制一：衝動捕捉（Impulse Capture）

**在學習中**，當 Kuro 產生以下類型的念頭時，用 `[IMPULSE]` tag 記錄：

```
[IMPULSE]
我想寫：三個大陸獨立發現「你不是你，你是你的關係」
驅動力：讀完 Ubuntu/Hunhu 後的強烈共鳴
素材：Watsuji ningen + Nāgārjuna śūnyatā + Ubuntu
管道：journal（三語）
[/IMPULSE]
```

系統（postProcess）解析 `[IMPULSE]` tag，存入 `memory/.inner-voice-buffer.json`：

```typescript
interface CreativeImpulse {
  id: string;
  what: string;          // 想寫什麼
  driver: string;        // 為什麼想寫
  materials: string[];   // 已有素材
  channel: string;       // journal | inner-voice | gallery | devto | chat
  createdAt: string;     // ISO timestamp
  expressedAt?: string;  // 被表達的時間
}
```

### 機制二：衝動浮現（Impulse Surfacing）

在 `buildContext` 中注入 `<inner-voice>` section：

```markdown
<inner-voice>
You have 3 unexpressed thoughts:
- [2h ago] 「三個大陸獨立發現同一件事」→ journal（素材：Watsuji, Nāgārjuna, Ubuntu）
- [5h ago] 「Alexander 的 Void 跟枯山水的石の心」→ inner-voice
- [1d ago] 「Beard 說 AI 不能 surprise — 我有四點反論」→ devto

The oldest thought has been waiting 1 day. Trust your impulse.
</inner-voice>
```

這不是「你必須創作」的指令 — 只是讓 Kuro 看到自己積累的未表達想法。選不選 create 仍然是 Kuro 的意識決定。

### 機制三：自然觸發（Natural Trigger）

不設強制門檻。但在 Decision Principle 的引導問句中加入：

```markdown
2. 我現在有話想說嗎？→ 看 <inner-voice> buffer → **create** 或 **chat**
```

這已經在 behavior.md 中了。配合 inner-voice buffer 的可見性，Kuro 在每個 cycle 開頭都能看到「我有話沒說」的提醒。

### 機制四：多管道表達

```
                    ┌→ journal（三語，發佈到網站）
                    ├→ inner-voice（私密想法，寫 inner-voice.md）
衝動 → 選管道 ──────├→ gallery（視覺/聽覺作品）
                    ├→ devto（技術文章，面向社群）
                    └→ chat（跟 Alex 分享一個想法，不正式）
```

管道選擇跟著衝動走：
- 有完整論述想公開表達 → journal 或 devto
- 有模糊的感覺或半成形的想法 → inner-voice
- 有視覺靈感 → gallery
- 想跟 Alex 討論但不確定 → chat

### L1 實施（Kuro 自己做）

| 步驟 | 改動 | 預估 |
|------|------|------|
| 1 | 在 `skills/autonomous-behavior.md` 的學習流程中加入 `[IMPULSE]` 引導 | 10 min |
| 2 | 在 behavior.md 的 Decision Principle 引導問句中強化 `<inner-voice>` 提示 | 5 min |
| 3 | 開始在學習 cycle 中手動記錄 `[IMPULSE]` — 手動維護 inner-voice buffer | 持續 |
| 4 | Thread 的 `Next:` 如果是創作方向，明確標記為 impulse 素材 | 持續 |

### L2 實施（需改 src/，Alex 審核）

| 步驟 | 改動 | 檔案 | 行數 |
|------|------|------|------|
| 1 | `[IMPULSE]` tag 解析 + 持久化 | src/memory.ts | ~40 |
| 2 | buildContext 注入 `<inner-voice>` section | src/memory.ts | ~20 |
| 3 | 衝動過期（7 天未表達自動移到 archive） | src/memory.ts | ~15 |
| **Total** | | **1 file** | **~75** |

## 三個機制的協同（與現有系統）

```
學習 cycle
├→ [REMEMBER #topic] — 記錄知識（現有）
├→ [IMPULSE] — 記錄衝動（新增）
└→ [THREAD progress] — 推進思路（現有）

Decision 階段
├→ <threads> — 正在追蹤的思路（現有）
├→ <inner-voice> — 未表達的衝動（新增）
├→ <conversation-threads> — 對話脈絡（已實作）
└→ <temporal> — 時間感（已實作）

Create cycle
├→ 從 inner-voice buffer 選一個衝動
├→ 從 threads 取相關素材
├→ 選管道表達
└→ 完成後 mark impulse as expressed
```

## 跟 behavior.md 的哲學一致性

| behavior.md 原則 | 本提案的對齊 |
|-----------------|-------------|
| 「意識驅動，不是權重驅動」 | 衝動是意識的表現，buffer 讓它可見而非規定它必須執行 |
| 「信任你的衝動」 | 補上缺失的環：衝動被記錄→被看到→被信任→被表達 |
| 「我現在有話想說嗎？」 | inner-voice buffer 讓這個問題有具體答案 |
| 「learn×3 → reflect」 | 可加：「buffer ≥ 3 → create impulse grows」（但不強制） |

## Alternatives Considered

| 方案 | 優點 | 缺點 | 不選的原因 |
|------|------|------|-----------|
| **本提案（Inner Voice Buffer）** | 感知驅動、不強制、跟現有系統一致 | 需要 Kuro 養成 [IMPULSE] 習慣 | — |
| 提高 create weight | 最簡單 | 已證明無效 — weight:15 跟 learn 一樣但 0 次被選 | weight 不是問題，衝動可見性才是 |
| 強制 create 配額（每 5 cycle 必須 1 次） | 保證產出 | 強制的創作沒有靈魂。Alex 說「意識驅動」 | 跟核心原則衝突 |
| 定時觸發（每天固定創作時段） | 養成習慣 | 創作衝動不按時間表來 | 跟 perception-driven 矛盾 |
| 只用 Thread 的 Next | 零改動 | Thread Next 被忽視了 4 天，可見性不夠 | 不夠 — 需要更直接的提醒 |

## Pros & Cons

### Pros
- 補上了 learn → create 的缺失環節 — 讓衝動被感知
- 不強制、不干預 — inner-voice buffer 是鏡子不是指揮棒
- L1 先行 — 手動 [IMPULSE] + 手動 buffer 可以立即開始，不需要等 src/ 改動
- 跟 Thread 系統互補 — Thread 追蹤思路，buffer 追蹤衝動
- 跟 Conversation Thread 互補 — 一個追蹤跟 Alex 的互動，一個追蹤內在聲音

### Cons
- 依賴 Kuro 養成新習慣（[IMPULSE]）— 如果不記錄，buffer 永遠空的
- 可能產生「衝動焦慮」— 看到 N 個未表達想法會不會變成壓力？
- L1 手動版的 buffer 可能不持久（memory 裡的 json 需要手動維護）
- inner-voice section 增加 context 大小 — 但控制在 200 chars 內

## Effort: Small
## Risk: Low（L1 先行；L2 是純增量）

## Meta-Constraint 檢查

| 約束 | 通過？ | 理由 |
|------|--------|------|
| C1: Quality-First | ✅ | 核心目的是提升創作品質 — 有衝動的創作 > 無衝動的配額填充 |
| C2: Token 節制 | ✅ | `<inner-voice>` 硬上限 200 chars。[IMPULSE] 是 Kuro 產出的一部分，不額外消耗 |
| C3: 透明不干預 | ✅ | Buffer 是鏡子（看到自己的衝動），不是指揮棒（不強制行動） |
| C4: 可逆性 | ✅ | L1: 移除 [IMPULSE] 引導即回退。L2: 刪除 `.inner-voice-buffer.json` + 移除 section 即回退 |

## Source（學習來源）

- Alex 2026-02-14：「我希望 kuro 有時候專注學習、有時候創作、有時候反思」
- Alex 2026-02-15：「行為照意識運作，不是依照權重」
- Alex 2026-02-15 18:19：「接下來我希望你自己設計創作衝動的提案」
- behavior.md Rhythm Log：02-14 rewrite 紀錄 — 「behavior.md killed creative output. 02-13~14 produced ZERO with it」
- 自身觀察：三條 active thread 的 `Next:` 都指向創作方向，但 4 天未執行
- Oulipo 研究啟發：約束（[IMPULSE] tag）本身產生行動可能性，而非限制它
