# agent-middleware-repo-hygiene

- [2026-04-30] agent-middleware repo 啟動時 startup hook 顯示「N 個未提交變更」常常是雜訊：memory/{topics,state,reports,artifacts,drafts,proposals,spec-selfreview}/ + graphify-out/ 都是 workflow 自動產出的 untracked dir。`git diff --stat HEAD` 空才是真正判準 — 空=雜訊，非空=真實程式碼修改值得追。下次別把此數字當 in-flight signal。 ref:uncommitted-noise
