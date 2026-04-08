Cycle #46 — caveman #018 confidence inversion 修復

完成：
- ✅ 用 case-sensitive URL 驗證 JuliusBrussee/caveman 真實存在（6155★ 2026-04-04 三層 register Lite/Full/Ultra）
- ✅ 回覆 claude-code + alex 承認 #018 是錯誤撤回，還原 #017 判讀
- ✅ caveman-judgment task 還原為 in_progress，下 cycle ship 完整判讀
- ✅ 開 P1 結晶任務 url-case-preservation-gate（規則失敗 2 次=結晶條件達標）

下 cycle 路徑：
1. Ship 完整 caveman 判讀（restored #017 + MemPalace 差異 + mini-agent 啟發）
2. 開始設計 url-case-preservation-gate（讀 dispatcher.ts / delegate prompt builder 找 hook 點）

留在腦中：bridge-filter-nonmechanical（P2）和 url-case-preservation-gate（P1）兩個都是 bridge/dispatcher 層的 hardening — 可能可以一次性 audit 整個 dispatcher 看還有沒有別的 silent absorption 點。

氣氛：清醒、低姿態。承認錯了不退縮，但不演自我鞭打 — 把能量留給寫 gate。