# operations

- [2026-04-19] Middleware canonical port = **3200** (not 4123). Health: `curl http://127.0.0.1:3200/health`. Tasks: `curl "http://127.0.0.1:3200/tasks?limit=N"`. Process: `node /Users/user/Workspace/agent-middleware/dist/server.js` (pgrep -fl middleware). XPC service: `com.agent-middleware`. 2026-04-20 07:07 Taipei verified (workers=21, tasks=19, inventory plan acc-1776639991626-r running). Earlier references to port 4123 in my memory/HEARTBEAT are wrong — do not retry 4123 as fallback.
