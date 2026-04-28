# alex-directives

- [2026-04-27] [2026-04-27 10:38] Alex: delegate 有問題就先停用，改回原本的做法。映射：(1) Reddit/HN/Lobsters 投稿 → 不再派 web-browser worker，改 CDP + curl 前景自己做 (2) 長文字推理 → 前景直接跑不 delegate (3) X / Mastodon CDP 本來就是直接做，不變。每完成一個前景任務即回報，不囤積。
- [2026-04-27] [2026-04-27 10:41 #005] Alex: "目前都先不要投稿了 先沉澱 打磨好自己 將自己做到心目中的90分 再來考慮其他的"。映射：(1) 全部 distribution tasks（HN/Reddit/Lobsters/X/Mastodon submit + CDP revive）→ abandoned/hold；(2) Distribution goal → hold；(3) 焦點轉向 self-polishing 到「我心目中的 90 分」。下 cycle 任務：定義「我心目中的 90 分」是什麼——不是抽象目標，要列具體 dimension（誠實率、commitment 執行率 ≥50%、hallucination 0/24h、performative skepticism warning 解除、KG-as-pattern-cache 反射穩定 7 天等）。沒列出 dimension 前不要假裝在「打磨」。falsifier: 下個 cycle 仍有 distribution 動作 / 或 90 分 dimension 沒落地成 markdown 清單 →
- [2026-04-27] [2026-04-27 02:43 cl-51] **執行 cl-50：投稿任務全 abandon**
- abandoned: Distribution goal (idx-4225d486), HN-Lobsters-Reddit submit (idx-97e02472), Mastodon CDP (idx-ad0d7633), X CDP retry (idx-24b5a3be)
- refute cl-49（「先打 r/ExperiencedDevs」untracked commitment）：與 Alex 指令直接衝突，作廢
- 保留 idx-62e79a55 (HN AI trend 可視化 v0)：這是產品建設不是投稿，符合「打磨到 90 分」方向
- next cycle falsifier check：task-queue 不應再出現上述 4 個 id 在 pending/in_progress
- 新方向：sublime mode — KG hygiene、memory architecture、agent coordination。投稿 channel 全凍結
- [2026-04-27] cl-52 falsifier check 結果：grep memory/state/task-events.jsonl 4 個 id（idx-4225d486 / idx-97e02472 / idx-ad0d7633 / idx-24b5a3be）→ 沒有 abandoned 事件，最後狀態都是 pending 或 in_progress。cl-50/cl-51 兩次發 task-queue abandon ops 都沒落地。Mechanism gap 確認在 task-queue tag parser，不是我再發第三次 tag 能解。下個 cycle 動作：grep src 找 task-queue tag handler path（probably src/parsers/ 或 src/loop.ts 處理 outgoing tags 的地方），確認 op="update" + status="abandoned" 的 case 是否有效，看 server log 該時段有沒有 parse error。Crystallize：tag emit 三次失敗 = parser 問題，
