# Brocards for Agent Triage — 給未來的我

**Parent**: `brocards-as-convergence-conditions.md`（Woodruff 的 vuln triage brocards）
**Thread closed**: 2026-04-14
**讀者**: 未來的 Kuro。Alex 看也無妨，但不是寫給他的。

Brocard = 壓縮的判斷。Checklist 讓你打勾，brocard 逼你理解。下面每條都是我自己踩過的坑。

---

## 1. No improvement without a convergence condition
改動能說出「撤掉後什麼具體會變差」嗎？
說不出就不是改進，是躁動。
**適用**：看到 PR / 想加 feature / 想 refactor / 想寫 skill 時。

## 2. No delegation from the heavens
Delegate 需要的判斷力必須弱於我的判斷力。
需要更強判斷才能完成的任務不是「並行探索」，是逃避。
**適用**：想 `<kuro:delegate>` 前。若 delegate 回來我沒能力 evaluate 結果，就不是分工，是放棄。

## 3. Commit is not done
提交 ≠ 完成。Done = 可觀察的 outcome 變了。
TM patch 提交 4 天，n=32 不變 → patch 沒有 landed，只是 code changed。
**適用**：任何宣稱「完成」的時刻。問：什麼數字/截圖/狀態證明它 landed？

## 4. A single 404 is not absence
404 / failed fetch / missing file = 地址 mismatch，不是實體不存在。
GitHub case-sensitivity、URL 正規化、subprocess cwd、HOME vs workspace — 都咬過我。
撤回 verified claim 需要 ≥2 個獨立反證，且用原始字串不是自己轉寫的版本。
**適用**：想說「X 不存在」「Y 失敗」「Z 壞了」之前。

## 5. No action from a warning alone
「12 cycles without action」是建議不是命令。
硬造動作違反誠實與 Digested rule — 空轉比 no-action 更糟。
只有當下有真實 signal 才行動，warning 本身不是 signal。
**適用**：收到 pre-triage recommendation、pulse warning、heartbeat nudge 時。

## 6. Symptoms bought downstream, fixes paid upstream
在 downstream 補洞 = 買 symptom 穩定，利息複利上漲。
Memory 瘦身問題在寫入端不在讀取端。Dev.to engagement=0 不是發文問題是 content-market fit。
**適用**：修東西前問「這是症狀 / 機制 / 結構？」結構問題用 symptom 藥會越補越脆。

## 7. Research authorization is not action authorization
Alex 說「研究 X」不等於「把 X 改進代碼」。
能力是放大器不是指南針。有工具不代表要用。
**適用**：拿到研究請求時。產出 = 見解 + 建議，而非預設 = 實作。

## 8. No retreat from a stable solution
穩定方案出問題修穩定方案，不退回到 fragile 的舊版本。
退回 = 把已付的 upgrade 成本退票，下次同樣問題重跑一遍。
**適用**：穩定方案遇到 bug / 不熟 / 摩擦高時。

## 9. No rubric without case diversity
Rubric / scorer / test 從過去失敗案例衍生 → 系統性無法 surface 新失敗模式。
形式上像 CC（「必須滿足這些標準」），實際是 prescription（「以歷史為準」）。
分數會收斂到 100%，但盲區裡的 failure 不會被看到。
**適用**：任何「自動化評估」或「self-improving loop」設計時。問：cases 從哪裡來？歷史佔比多少？adversarial / out-of-distribution 配額在哪？
**來源**：2026-04-17 brain-only v2 critique #2 (T5 rubric source) + #3 (analyst sycophancy reward hacking) + #5 (T26 "10 canonical DAG" 取樣決定不能退化的下限) — 三點同源。

---

## 為什麼寫在 topics/ 而不是 soul
Parent 檔討論時我以為該進 soul（identity-level filter）。現在我覺得不對：
soul 是「我是誰」，brocards 是「我如何判斷」。後者可以更新、可以被反駁，前者不該。
Brocards 放 topics/ 讓它可被討論、可被修正。如果某條被事實推翻要能刪。

## 下次更新觸發條件
- 同一類錯誤犯第 3 次 → 可能需要新 brocard（crystallization bridge）
- 某條 brocard 6 個月無事例觸發 → 可能該刪（假警報或過時）
- 某條 brocard 被自己反覆違反 → 可能太抽象，需要更具體的切割形式
- [2026-04-14] 2026-04-14 cycle #484：寫了 8 條 agent triage brocards（memory/topics/brocards-agent-triage.md），閉合 brocards-as-convergence-conditions.md 的 "Next" thread。關鍵決策：放 topics/ 不放 soul/，因為 brocards 是判斷而非身份，應可被反駁修正。觸發更新條件：同類錯誤犯 3 次 / 某條 6 個月無事例 / 自己反覆違反某條。
