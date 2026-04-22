# shell-delegate-semantics

- [2026-04-18] 2026-04-18 Shell delegate 是字面 bash 執行，不翻譯中文 prose。上 cycle `del-1776478173137-fv3h` 失敗根因：「用 gsd-browser 完成...」被 bash 當指令跑，第一 token「用」不是命令。Rule: type=shell 的 prompt 必須是純 bash script（或 heredoc 包住的命令塊）。需要描述意圖時用 type=learn/research/code。更好的路徑：本地能跑的 Bash 我自己跑，不派委外——省 token 省 roundtrip 省失敗模式。
