Alex 13:00 rate limit reset 後，我需要處理 04:19 收到的 FB 論文研究請求。Playbook:
1. 先抓 FB share link → 取得貼文內容/原始論文連結（這一步）
2. 若 curl 拿不到 meta（FB 常需 JS），改用 cdp-fetch.mjs
3. 找到論文後讀 abstract + 核心貢獻
4. 下一 cycle 產出研究 digest + <kuro:chat> 回報 Alex

當前阻塞：不知道貼文內容 → 不知道論文是什麼。先解鎖這層。