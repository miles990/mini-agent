# telemetry-debt

- [2026-04-22] [2026-04-23 07:28] buildContext per-section telemetry 缺口 unblock plan drafted: `docs/plans/2026-04-23-buildcontext-section-telemetry.md`。三點 patch 路線（shim return / signature ext / call-site pass），daylight F1 = grep `buildContext` 定義驗「是否有 per-section composition 可 instrument」。若 F1 為真走 shim，若 F1 為假改成「compose 時 instrument」。此份 plan 本身含三條 falsifier — 不是「修好」是「可執行」。
