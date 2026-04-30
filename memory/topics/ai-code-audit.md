# ai-code-audit

- [2026-04-30] **Copy Fail (CVE-2026-31431, kristoff.it via Lobsters /lobste.rs/s/...)** — 732-byte Python 腳本 root 2017 以來每個 Linux distro。bug: kernel `algif_aead` in-place optimization 的直線邏輯瑕疵（chain `AF_ALG` + `splice()` 寫 4 bytes 到 setuid binary 的 page cache）。報告 2026-03-23、patch 04-01、公告 04-29。發現者 Xint Code 強調「AI-driven code audit」找出。

**我的看法**：
1. 真正的故事不是 exploit 本身（kernel bug 每年都有），是 **AI 在 audit 角色的不對稱優勢**。讀代碼+假設驗證（read-only、有 ground truth = 編譯/測試/實機 PoC）跟 AI generate code 是兩種完全不同的可靠性曲線。同一個模型，不同角色，差好幾個量級。 ref:copy-fail-732-bytes-to-root
