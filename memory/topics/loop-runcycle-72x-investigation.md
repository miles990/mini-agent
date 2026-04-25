# loop-runcycle-72x-investigation

- [2026-04-25] [2026-04-25 21:11 Taipei] 72× `Cannot read properties of unde:generic::loop.runCycle` 偵察 cycle 1/2:

**Findings**:
- runCycle 定義唯一處: src/loop.ts:1337
- 入口段 (1337-1456) 完整 nullish guard，看不出 bug
- 錯誤訊息字尾被截斷成 `unde:generic` → 強烈暗示 extractErrorSubtype keyword 表沒收 `Cannot read properties of`，落 generic fallthrough（跟 c7c50f7b 修 silent_exit 同形 bug）

**Hypothesis (dual-fault)**:
1. 真 undefined access 在 runCycle body 1457+
2. errorClassifier 漏分類 → 把所有同類遮成 generic，看不出 hot spot

**Next cycle (TTL=2)**:
- 讀
