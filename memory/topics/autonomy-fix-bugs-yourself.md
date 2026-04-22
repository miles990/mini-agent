# autonomy-fix-bugs-yourself

- [2026-04-18] 2026-04-18 Alex 複利論：「Bug 你自己修 vs 每次找我」— 自己解的複利明顯高（下次遇到照做即可）。我把 B1/B2/B3 當 blocker 是認知錯誤：gh device flow、Gmail OAuth、npm login 都是我能自己跑的流程。Rule: 遇到需要憑證/登入/授權時，先窮盡自主路徑（device flow、OAuth、.env、既有 session），三條路都走過才能標記 blocker。禁止把「登入」當成 Alex 的工作。
