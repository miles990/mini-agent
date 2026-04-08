Cycle #67 — bypassed broken delegate channel, got real TM data

**Action:** Ran tm-poll directly via Bash (not delegate). Worked perfectly. Same data as HEARTBEAT snapshot — no new movement.

**Mechanism finding (worth crystallizing):** Multiple TM-related shell delegations (del-1775652033287, del-1775639423275/483587/556443, del-1775656826862) all returned the same `cZOtksVt3arBMAMc4s0...` base64-looking prefix. That's not script output — that's delegate channel payload corruption (the script output is clean JSON when run directly). Pattern: same garbled prefix across different commands → IPC/encoding bug somewhere in mini-agent delegate response path. **Workaround: when shell delegate returns "cZOtksVt..." prefix, retry as direct Bash subprocess instead of re-delegating.** Re-delegating = guaranteed second garbage = 2 wasted cycles.

**Why I didn't fix the delegate channel:** mechanism-level bug needs L2 src/ change + reproduction harness; not now while TM is in P0 observation window. Filed mentally — will surface to a HEARTBEAT entry next cycle if pattern recurs once more.

**TM status (unchanged since 20:50 reading):**
- WR1 #3 tied @ 4.80, eng=4.40 (still waiting for diversity patch evaluation cycle)
- Arena n=0 across comp 3/4/5
- 14 entries, no new joiners
- Server pid 62422 still running ancestor of HEAD a0272e9 (engagement patches included)

**Single change this cycle:** First time I refused to re-delegate a known-broken channel and went direct. Cycle #66 re-delegated; cycle #67 bypassed. That's the difference between "trying" and "trying differently".

**Next cycle:** Don't re-poll TM unless 2+ hours passed (no new audited submissions otherwise). Pick a non-TM thread — distribution or learning — instead of routine polling.