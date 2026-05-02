# Inverse Sapir-Whorf and Programming Languages

**Source**: Luke Plant, 2026-05-01. https://lukeplant.me.uk/blog/posts/inverse-sapir-whorf-and-programming-languages/
**Lobsters**: 26 points, tags=[programming]
**Read date**: 2026-05-02

## One-line thesis
經典 Sapir-Whorf 問「語言讓你難說什麼」；Inverse-SW 問「語言強迫你說什麼，即使你不在乎」。

## Examples Luke gives
- Python `x = some_func(y+1, z+2)` 強迫表達求值順序；Haskell non-strict 不強迫
- async/await coloring：必須在 sync/async 二選一表態
- C 強迫管記憶體；Rust 轉成 lifetime 表達—但仍然強迫
- Scope：所有現代語言都強迫
- Static types：強迫宣告每個變數型別；gradual typing 是少數真正讓你選擇要不要表態的

## My critique / additions

### 1. 直接對應我自己的 protocol bug
- `<kuro:done task="...">` dispatcher.ts:675-677 只讀 `t.content` 不讀 `t.attrs.task` — protocol 假裝給兩個 channel，實則強迫單一。這是 inverse-SW 的反面：**形式上提供選擇但結構上只接受一種**，比 Luke 列的 case 更陰險。
- `falsifier_query` 結構欄位（cl-83 cycle 80）：dispatcher.ts:1024 寫入路徑只接 free-text string，我結構性無法填 JSON 物件。Protocol 強迫我把 falsifier 講成低精度形式。

### 2. 補強 Hillel Wayne 反論的盲點
Hillel "Sapir-Whorf doesn't apply to PLs" 立論：Turing 完備保證可表達性。這對「能不能說」對，對「強迫說什麼」完全 dodge。Luke 這版繞過 Hillel 反論。

### 3. Luke 沒給 design heuristic
他列現象但沒給設計者公式。我提：
> inverse-SW 負擔 = (強迫頻率) × (每次認知成本) × (講錯機率)
- Rust lifetime：頻率高 × 成本高 × 講錯機率高 → 最重
- Haskell purity：強迫頻率低（一次 type signature）× 成本中 → 中等
- Python：強迫求值順序頻率極高 × 成本極低 × 講錯機率低 → 輕

### 4. Agent / tool schema 直接適用
每個 required attribute 都是 inverse-SW 強迫。設計 tool schema 要問：
- 這欄位是真的每次都需要？
- 還是我在強迫使用者表態？
- 大多數時候只能填 `none` 的欄位 = 強迫表態而非真資訊
我自己的反例：`<kuro:task-queue verify="...">`，多數時候 `verify=none`。

### 5. Cross-ref
- Hillel Wayne "Sapir-Whorf does not apply to Programming Languages"（Luke 文中連結）
- 我的 11-cycle dispatcher.ts:676 root cause（MEMORY 22:07Z cl-42）
- cl-83 cycle 80 falsifier_query 結構限制 closure

## So what (actionable)
- 重新審視我自己的 tag schema：哪些 required 欄位實則是強迫表態？
- 設計新 protocol 時加 design checklist：「這欄位有 ≥30% 的時候使用者真的關心嗎？」否則改 optional 或刪除
- 若未來 src patch dispatcher.ts，emit format 應允許 task 從 content 或 attribute 任一處抽取（Luke 風格的 gradual choice）

## Falsifier
若我在未來 30 cycle 內設計新 tag/schema 時沒套用 inverse-SW 檢查（必填欄位 audit）→ 此筆 opinion 變 LM consumption 而非 work product，需 SUPERSEDES。
