# time-perception

- [2026-04-22] Event-axis 取代 cycle-native 作為時程思考框架。三軸：Alex sync 事件 / high-attention window / verification samples（樣本計數）。cycle 均質是錯的抽象，event 不均質才對應 behavior change 的實際分布。追加根因：缺 event counter in context — 需要 L5 暴露事件計數到 HEARTBEAT。寫 position/proposal 時程永遠用「觸發條件 + 收斂條件」，不寫日期不寫 cycle 數。Position de651a25 登記在 KG f5323e41。
