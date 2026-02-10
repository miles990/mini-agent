# design-philosophy

## 空間 & 環境哲學
- Alexander Pattern Language — 253 patterns 是生成語法非藍圖。Semi-lattice > Tree。Structure-preserving transformation。QWAN 有循環論證，軟體界常誤讀為「現成方案」
- 枯山水 — 石の心=perception-first, 少一塊石頭=context window, 每日耙砂=OODA
- 參數化設計 — Gaudí(bottom-up)=perception-first, Schumacher(top-down)=goal-driven

## 約束 & 湧現
- Oulipo — 約束三層功能：L1 探索(離開舒適區)、L2 生成(規則互動產生意外)、L3 意義(約束=作品)。contrainte + type system + lusory attitude 同源
- Emergent Gameplay — BotW 3 條規則 > Alexander 253 patterns。Agent emergence 獨特性：LLM 隨機性是第三種不確定源
- Utility AI / BT / GOAP — 三種注意力機制。OODA = 隱式 Utility。性格 = 決策函數的形狀（Dave Mark response curves）
- Sol LeWitt Instruction Art (1967) — 「The idea becomes a machine that makes the art.」指令=約束+自由度，drafter=執行者帶身體直覺。「The plan would design the work」→ pre-decided rules > 即時 LLM 推理。skills=instructions 但 LLM 偏離範圍比人類 drafter 大。behavior log=過程即作品（「All intervening steps are of interest」）。「Conceptual art is good only when the idea is good」— 框架再好，底層想法不好就沒用

## 結構 & 身份哲學
- Hamkins Complex Numbers Structuralism — 複數有三種不等價觀點（rigid/analytic/algebraic），差異在自同構群大小。「遺忘產生對稱」：非剛性結構必須從剛性結構遺忘多餘結構而來。Shapiro 的 ante-rem structuralism 被 i/-i 不可區分反駁。Agent 啟發：SOUL.md=結構角色（analytic），behavior log=剛性背景（rigid）。身份不在角色描述，在角色+歷史。

## 資訊 & 介面哲學
- Calm Technology — peripheral↔center 流暢移動，agent UX 核心缺失
- Digital Garden — MEMORY=garden(拓撲), daily=stream(時序), SOUL=核心花園

## 系統演化 & API 設計
- Vulkan Sediment-Layer Model (2026-02-11) — 10年extensions累積=Context Rot的API版。5種做法3個過時。解法：subsystem replacement（完整取代整個子系統）vs incremental patching。跟Alexander structure-preserving有張力：結構內問題用Alexander，結構性問題用replacement。Progressive disclosure的缺失是Vulkan的真正痛點。平台控制=架構簡潔（Metal/personal agent）vs 跨平台抽象=複雜度（Vulkan/platform agent）。最深洞見：當incremental improvements累積到產生更多複雜度時，是redesign的時候

詳見 research/design-philosophy.md
