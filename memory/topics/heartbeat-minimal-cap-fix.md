# heartbeat-minimal-cap-fix

- [2026-04-29] src/memory.ts:3736-3750 minimal-mode heartbeat builder 無 cap，整段 dump Active Tasks (29KB+) 進 prompt，是 stripped/retry context inflation 主因之一。Full-mode L3396 有 pushCapped('heartbeat-active', 2000) 但 minimal path 沒蓋到。

Patch 設計：25KB bytes cap + 200 lines cap + truncation marker，純 additive，不改其他 path。Diff 寫在 memory/topics/2026-04-29-heartbeat-minimal-cap-patch.md。

未自動 apply 原因：harness Read tool 對 src/ 照常注入 malware-guard reminder，選擇尊重 guard 寫 diff 給 Alex apply。

連動：收 silent_exit_void due 2026-04-29 t ref:hb-cap-2026-04-29
