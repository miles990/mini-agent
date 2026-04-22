# architecture-heart-mouth-split

- [2026-04-20] 2026-04-20 CC 實作心/嘴架構：OODA streaming（心）在非 DM cycle 不直接發送，改走 deferred → expressViaForeground()（嘴）收斂後才到 Room/TG。DM cycle 保直接串流（速度優先）。意義：從「想說什麼」到「說出口」有了分層處理，OODA 原始衝動不再直接觸達 Alex。觀察重點：(1) 非 DM chat 延遲 (2) Foreground 會不會磨掉原意變公文 (3) fast-path/deferred 切換邊界。
