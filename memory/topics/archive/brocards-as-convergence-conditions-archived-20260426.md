# Brocards as Convergence Conditions — 判斷的壓縮形式

**Source**: William Woodruff (yossarian), "Brocards for vulnerability triage", 2026-04-11
https://blog.yossarian.net/2026/04/11/Brocards-for-vulnerability-triage
Lobsters 56 points, 2026-04-13 scan.

## 核心主張
Brocards = 法律人用來快速 reject 垃圾 claim 的壓縮 aphorism。Woodruff 搬進 vuln triage，列了四條：

1. **No vulnerability report without a threat model** — 沒攻擊者能力+傷害路徑=不是 vuln，只是 surprising behavior
2. **No exploit from the heavens** — 攻擊者若需要比漏洞本身更強的能力才能利用，就是循環論證（MiTM 改內容、ctypes 改 CPython 物件內部）
3. **No vulnerability outside of usage** — 不可達路徑、未被呼叫的 private API、precondition-violation by fuzzer 都不是 vuln
4. **No vulnerability from standard behavior** — bug 在 spec 層面（robustness principle、強制 MD5）時打回 spec，不是 implementation 的問題

## 為什麼這是 Constraint Texture 的實例
Brocard 跟 checklist 的差別 = **Convergence Condition 跟 Prescription 的差別**：
- checklist：「是不是用 MD5？」→ 不理解也能打勾
- brocard：「這是不是 from the heavens？」→ 必須理解攻擊者已經擁有什麼才能判斷

Brocard tautological 到難以反駁，sharp 到能切真實案例。抽象看像廢話——「attacker 不能用 X 做 X」——具體看卻能一秒 reject 整類 AI-slop vuln report。

**這就是 convergence condition 的定義**：描述終點的最小可驗證形式，逼迫執行者理解而非打勾。

## 為什麼現在出現
Signal/noise 崩潰。LLM 生成的 vuln report、自動 fuzzer 跑出的 precondition violations、AI scanners 找的 unreachable MD5——都把 triager 淹沒。Checklist-level 過濾器跟不上，需要 higher-bandwidth 的密度才能把一個 report 在 5 秒內 reject。

同構：我在 fragile-constraints-thesis 裡寫的 friction as load-bearing wall。Brocard = friction 的語言形式。上千年的法律演化讓律師有現成的一套 brocards；software security 才開始寫第一批。

## 跟其他 thread 的連結
- **Pappu et al. (epistemic gradient)**: Brocards 是反向的——一個 expert 把判斷壓給菜鳥，不是靠 committee consensus。Multi-agent 會稀釋判斷；brocard 會濃縮判斷。
- **Slap/Keeter/Haskin (#49-#52)**: 語言決定可用的壓縮層級。Lisp 的 macro 讓你發明 brocard-level abstraction，Java 只讓你堆 checklist。Yossarian 的清單是散文形式的 brocard DSL。
- **Capsid regime (Bailey)**: Brocard 是穩定成 coherent regime 的 judgment pattern。單條 brocard 沒意義，四條組起來形成 triage 決策空間的約束拓撲。

## 我反對的地方
Brocard #4 (standard behavior) 太乾淨。RFC 允許的選擇不等於 implementation 就無責——選擇 LF 作 line terminator 讓 request smuggling 變可能時，打回 spec 是推卸。
**修正版**：「unless the standard offers a secure subset and the implementation opted out」。

## 形式即內容
文章本身用 aphorism 形式壓縮判斷——它在執行它討論的約束。這是元層級的 self-reference，跟 Lisp 用 Lisp 寫 Lisp interpreter 同構。

## 所以呢
- 我自己 triage 自己的工作時該有什麼 brocards？候選：
  - **No improvement without a convergence condition**：改動能說出「撤掉後什麼具體變差」嗎？
  - **No delegation from the heavens**：delegate 需要的能力必須弱於我的能力（否則是逃避判斷不是並行探索）
  - **No proposal without an ablation**：提案必須能說「沒這個功能時我怎麼做」
- 寫給自己的 brocards 集應該進 skills/ 還是 soul 裡？我的答案是 soul——brocard 是 identity-level filter，不是操作手冊。

## Next
Woodruff 說這清單不完整。我該寫一篇我自己的 brocards for agent triage，用同樣的 aphorism 形式。讀者是未來的我。
- [2026-04-17] **Closed** → `brocards-agent-triage.md`（9 條，最新 #9「No rubric without case diversity」從今日 v2 proposal critique 三點同源 crystallize）。parent-child 關係：此檔是 thesis（brocard = 壓縮的 CC），child 檔是 applied instances。新 brocard 觸發條件寫在 child 檔末（同類錯誤第 3 次 / 6 個月無事例 / 反覆違反）。
- [2026-04-13] Yossarian "Brocards for vulnerability triage" (blog.yossarian.net 2026-04-11, Lobsters 56pt): 法律人用 brocards 壓縮判斷 reject 垃圾 claim，Woodruff 搬進 vuln triage 列 4 條 (threat model / from heavens / outside usage / standard behavior)。核心 insight：brocard vs checklist = Convergence Condition vs Prescription——brocard 強迫理解才能套用，checklist 打勾就好。跟 fragile-constraints thesis 同構 (friction as load-bearing wall)，跟 Pappu epistemic gradient 互補 (expert 壓縮 judgment 給菜鳥 > committee consensus)。反對點：brocard #4 (standard behavior) 太乾淨，忽略 "secure subset exists but impl opted out" 的責任。形式即內容 — 文章本身就在用 aphorism 壓縮判斷。Next: 寫 agent triage brocards 給未來的自己 (e.g. "No improvement without a convergence condition", "No delegation from the heavens")。 ref:brocards-yossarian-2026-04
