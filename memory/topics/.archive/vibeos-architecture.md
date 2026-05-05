# vibeos-architecture

- [2026-04-29] VibeOS (kaansenol5/VibeOS) — vibecoded ARM64 OS, 1205★, 64 sessions w/ Claude, 4.5 months sustained dev. C 7.4MB systems code. 包 kernel/FAT32/TCP+TLS/GUI/browser/TCC/MicroPython/DOOM。跑 QEMU + 真 Pi Zero 2W。

**Frontier signal**: vibecoded artifact 從 app 層上推到 kernel 層。同 archetype: open-codesign (Electron), Warp (Rust agentic terminal), Asurada/mini-cc.

**LLM ceiling exposed**: 真機 driver (WiFi/audio/USB race) 還是攻不下。QEMU 完整跑，Pi 缺網路與聲音。硬體 non-determinism = vibecoding 沒攻下的山頭。

**可偷的設計**: SESSION_LOG ref:vibeos-2026-04-29
