# buildcontext-telemetry-patch

- [2026-04-22] [2026-04-23 07:35 cycle #27] Daylight ship 前置驗證完成。F1=passed（per-section composition confirmed at memory.ts:2149）。Plan doc 兩處需修：(a) buildContext 定義在 memory.ts:2108 不是 context-optimizer.ts (b) shim 掛 InstanceMemory 不是 module。Patch pattern: 複製 bcMilestones（line 2126-2129）的 shape 建 sectionSizes record，每個 Promise.all 區段完後寫入，最後存 instance-level `this.lastSectionSizes`，loop.ts:3027 經 memory.getLastSectionSizes() 取值傳入 recordCycleNutrient。預估 daylight ship ~25 分鐘（原估 30 分鐘減 plan 已校正過）。
