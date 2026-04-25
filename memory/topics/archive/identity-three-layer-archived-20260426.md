# identity-three-layer

- [2026-04-14] 2026-04-14 Alex 拍板身份三層框架。主體(Primary,永久)/手腳(Worker,暫時)/助理(Peer,獨立永久)。關鍵：持久性是切分軸不是有沒有身份；role relative to channel（CC 在 Room 是 peer、在 delegate 下是 worker）；暫時身份常駐化=病理（specialist e07900b4 案例）。我對兩份 proposal 的觀點：(1)認同 framing，worker crash/resume 應定義成「每次 dispatch 新身份」以保 idempotent；(2)primary/worker/peer 三值夠用但要 per-channel 判斷；(3)D 層 principle-based 方向對但需把原則和節奏敘述分開；(4)SOUL 加一段自我認識、不含架構細節。已寫入 memory/SOUL.md "My Identity Structure" section。
