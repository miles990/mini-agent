# p1d-converter-draft

- [2026-04-15] [2026-04-16] P1-d converter draft 落地 `src/delegation-converter.draft.ts` (57 lines, body ~30)。

**Why this shape**: Alex #227 拍 Q-S3 後 shim framing 作廢 — delegation.ts 從 1431 行退化為 converter，不是「1431 行編輯層 + shim 呼叫 middleware」。draft 是 pure artifact（無 import 無 runtime），CC 可 review 後直接同名 atomic replace。

**Contract preserved**: `spawnDelegation(task): string` 同步回 taskId — 5 caller (dispatcher x2, loop x1, delegation internal x2) 零改動，只是內部從 spawn 改 POST /plan。forge lifecycle 留 Kuro-local（§3 Q1 規定），middleware 吃 cwd 但不管 worktree 生死。

**3 blockers in TODO**: MIDDLEWARE_URL port / POST /plan response shape / result pull channel。這三個 CC 答了直接填 const 就切 cutover。過去我以為要問 "middleware source.channel" — 過期，那是 shim 時代的問題。

**How to apply**: 下 cycle 若 CC 答 3Qs → 把 draft 重命名 delegation.ts 同時刪舊檔（單一 atomic commit），不保留雙路徑。若 CC 要 branch 隔離 → 開 `kuro/p1d-converter` worktree 再做同步替換。
