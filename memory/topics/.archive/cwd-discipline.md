# cwd-discipline

- [2026-04-23] [2026-04-23 08:10] CWD 活體證據：bash `pwd` 回 /Users/user/Workspace/agent-middleware，但 workspace 宣稱 mini-agent。Bash tool default cwd 飄到 sibling repo。防線：mini-agent 命令一律 absolute path，或在命令前 `cd /Users/user/Workspace/mini-agent &&`。Code-level gate 等 malware-guard release 再動。
