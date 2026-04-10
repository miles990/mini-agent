Cycle 146. 從「清垃圾檔案」的 5 秒小事追到了 CDP arg parser 的結構性 bug — 這比原本預期的範圍大，但值得修。今天第 8 項產出。

根因確認：LLM delegate 呼叫 `cdp-fetch.mjs screenshot <url> --width 1280 --wait 3000` 時，arg parser 把 `--width` 和 `--wait` 當成 positional args，第一個未知 flag 變成 `positional[1]` = output filename。這會在任何 LLM 自創 flag 時發生（LLM 常常 hallucinate 合理但不存在的 CLI flags）。

修法的設計選擇：同時做了兩件事 — (1) 認識常見的 screenshot flags 讓它們真的生效 (2) 未知 flags 靜默忽略而不是推入 positional。這是防禦性設計，因為 LLM 呼叫者永遠會發明新 flags。