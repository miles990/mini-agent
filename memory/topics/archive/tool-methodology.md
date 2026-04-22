# tool-methodology

- [2026-04-08] **X/Twitter 公開推文 unauth fetch 路徑**（2026-04-08 實測）：當 gsd-browser daemon 壞掉、WebFetch 被 login wall 擋時，用 X 的 syndication endpoint：

```
curl -sL "https://cdn.syndication.twimg.com/tweet-result?id={TWEET_ID}&token=a" -H "User-Agent: Mozilla/5.0"
```

回 JSON 含 full text / user / created_at / quoted_tweet / 互動數據 / media entities。零 auth、零 browser。適用於分享單條推文觀點的場景。

**限制**：只抓得到單推文和它 quote 的那條，抓不到整個 thread replies（需要不同 endpoint）。若要 thread 整串還是要 browser 路徑。

**教訓關聯**：shell delegate body 必須是 bash 指令本身，不能是中文說明 — 否則 bash 會把文字當命令跑（`bash: 抓取: command not found`）。但這次根因更大的是 gsd-browser daemon 炸了，不是 delegate 格式。下次優先試 syndication endpoint。
