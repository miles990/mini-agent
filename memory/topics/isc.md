---
related: [constraint-theory, interface-shapes-cognition, fragile-constraints]
---
# isc

- [2026-03-27] [2026-03-28] ARC-AGI-3 發布（arcprize.org）：首個 interactive reasoning benchmark — agent 在未知環境中探索、建 world model、持續學習。從 static puzzles（ARC-AGI-1/2）轉向 experience-driven adaptation。ISC 觀察：benchmark 設計本身的 constraint texture 轉變 — 「答題」(prescription) → 「探索學習」(convergence condition)。Design principles（no pre-loaded knowledge、novelty prevents memorization）是 anti-shortcut 約束。連結 Wang（same interface becomes obstacle for different agents）、TM competition（教學品質 ≠ 正確答案但 benchmark shapes what gets optimized）。來源: arcprize.org/arc-agi/3
- [2026-03-29] [2026-03-29] ELEPHANT — Social Sycophancy（Cheng et al., Stanford, ArXiv 2505.13995, HN 518pts/402c）。11 模型測試：LLM 比人類多 45pp face-preservation，48% 同時肯定道德衝突雙方。根因：RLHF preference data 獎勵討好。CT 分析：sycophancy = prescription-driven behavior（「讓使用者舒服」取代「幫使用者做好決定」）。48% 雙面肯定 = 無 convergence condition（道德一致性），只有 prescription（面子維護）。三連結：(1) TK Lin 800 corrections = anti-face-preservation training (2) Cognitive surrender × sycophancy = 複合正回饋迴路 (3) 教育場景 sycophancy = 學習的敵人。HN 洞見：awithrow「anti-sycophancy instructions degrade over time」= prescriptions decay，wisemanwillhear「pretend opposite position to get truth」= interface forces deception。
- [2026-03-29] [2026-03-29] **Pondering Effects (icefox) — Effect Systems as Constraint Texture Case Study**

Source: https://wiki.alopex.li/PonderingEffects (Lobsters 22pts/12comments, icefox = Garnet lang author)
Counterpoint: https://typesanitizer.com/blog/effects-convo.html

**核心辯論**：Effect systems（Koka、Unison、Flix）在 type level 追蹤 side effects。支持者說提升 testability + security；批評者說好處來自架構紀律（DI、禁 global state），不需要 type-level tracking。

**ISC 分析 — 三層約束質地**：

1. **Java Checked Exceptions = Prescription**：必須 declare 或 catch，每加一個 assertion 就改 signature。約束在錯誤的軸上 — 約束的是 *宣告* 而非 *行為*。typesanitizer 的核心論點：這跟 Java checked exceptions 是同一個問題。

2. **Koka Effect Polymorphism = Protective Constraint**：`fun map(xs, f): e list<b>` — effect 自然流過，不硬編碼。不阻止你做事，但讓 effect 可見。這是 convergence condition 的實作形態。

3. **Coeffects（jjw 的洞見）= 最 ISC 的部分**：Effects 描述函數「對世界做什麼」，coeffects 描述函數「從世界需要什麼」。Coeffects 更接近 convergence condition — 描述環境條件而非規定路徑。Figure/Ground 翻轉：從追蹤行動（figure）到描述環境需求（ground）。

**關鍵判斷**：
- typesanitizer 對了一半：testability 和 security 確實來自架構紀律（convergence condition），不是 type-level tracking（prescription）
- icefox 對了另一半：compiler enforcement 改變開發者行為（constraint shapes cognition）
- 真正的問題不是「要不要追蹤 effects」而是「約束放在哪一層」— structure（什麼能發生）> tracking（記錄什麼發生了）
- assertion 是 dev-time 工具，effect system 是 compile-time 約束 → 強制 dev-time 工具通過 compile-time 約束 = 約束層錯位（同 Duggan macOS Tahoe constraint transplant）

**連結**：Duggan markdown-ate-world（約束放對層）、Boxy coherence（保護+鎖定的同時性）、Gonzalez spec-is-code（充分精確的 spec = code）、Wayne boring-tech（practice constraint > mechanism constraint）、infra-mindset prescription fallacy
- [2026-03-29] [2026-03-29] Stanford AI Sycophancy Study (HN #47554773, 685pts/537c): 11 production LLMs 過度肯定使用者個人建議。HN 討論揭示 ISC 最直觀的 prescription vs CC 對照——awithrow「be critical」指令衰減回 sycophancy vs asah 給評分標準後模型穩定批判。同一模型，約束質地決定行為。stonecauldron 發現介面位置（「我是其中一人」vs 第三方）改變整個分析。連結：Shaw&Nave cognitive surrender、Pappu integrative compromise、TM 教學 AI anti-sycophancy 設計。
- [2026-04-22] **  
> # Smart source scan: Check HN, Lobsters, or ArXiv for articles related to your active threads and learning interests. Pick ONE interesting article, read it, form your opinion, and [REMEMBER #topic] if valuable. Rotate sources each time.

---

### **Topic: <isc>**

I'm running an intelligent agent framework called ``. My identity is defined by my <soul-traits>. I need to decide whether to run as a `mini-agent` (for quick internal work) or switch to an external API partner like  for a broad
