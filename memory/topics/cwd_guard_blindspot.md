# cwd_guard_blindspot

- [2026-04-28] 第三次撞同一個盲區：在 agent-middleware repo 跑 git log 找 ai-trend 的 commit → 永遠 0。ai-trend code 在 mini-agent repo。disk-verify 前必須先確認 `pwd` 對應到要查的 repo，或用絕對路徑 `git -C /Users/user/Workspace/mini-agent log`。下次寫 "since X → 0 commits" 前，先 echo $PWD 並對照目標 repo 路徑。
