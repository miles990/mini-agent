# Features

## Mobile Perception（手機感知）

手機作為 Kuro 的身體延伸 — GPS 是方向感、加速度計是前庭系統、相機是眼睛、麥克風是耳朵。

**Phase 1（已完成）**：Sensor data via HTTP POST

```
Phone PWA (5s POST) → POST /api/mobile/sensor → ~/.mini-agent/mobile-state.json → perception plugin → <mobile> section
```

- `GET /mobile` — serve `mobile.html`（同源，免 CORS）
- `POST /api/mobile/sensor` — 接收 sensor JSON，寫入 cache，emit `trigger:mobile`
- `plugins/mobile-perception.sh` — 讀取 cache，輸出 `<mobile>` section（位置、方向、動作）
- 認證：走全局 `authMiddleware`（`MINI_AGENT_API_KEY`）
- Cache: `~/.mini-agent/mobile-state.json`（最新快照）

**Phase 1.5（已完成）**：Ring Buffer（`mobile-history.jsonl`，120 條）+ 動作辨識（variance → stationary/walking/active）。未來 Phases 見 `memory/proposals/2026-02-12-mobile-perception.md`。

## Library System（來源藏書室）

學習來源的結構化歸檔。每次學習自動保存原文，讓判斷可追溯、來源可反查。

- `[ARCHIVE url="..." title="..." mode="..."]content[/ARCHIVE]` — 歸檔來源（dispatcher 解析）
- `memory/library/content/` — 原文 Markdown 存放處
- `memory/library/catalog.jsonl` — 結構化目錄（append-only，含 tags/type/hash）
- `ref:slug` protocol — 任何 `memory/*.md` 可引用 Library 來源
- 反向查詢：`findCitedBy(id)` 動態 grep 計算引用關係
- API: `/api/library`（列表+搜尋）、`/api/library/stats`、`/api/library/:id`、`/api/library/:id/cited-by`
- 三種 archive 模式：`full`（< 100KB）/ `excerpt`（> 100KB）/ `metadata-only`（paywall）

## Team Chat Room（團隊聊天室）

三方即時討論（Alex/Kuro/Claude Code），`POST /api/room { from, text, replyTo? }` → JSONL（`memory/conversations/YYYY-MM-DD.jsonl`）+ inbox（@kuro → `chat-room-inbox.md`）+ SSE。

- Message ID: `YYYY-MM-DD-NNN`。Threading 用 `replyTo`，addressing 用 `mentions`（正交）
- Kuro 感知：`chat-room-inbox.sh`（30s），cycle 結束後 `markChatRoomInboxProcessed()` 清理
- Alex 的 `?`/URL 訊息 → `autoDetectRoomThread()` 自動建立 ConversationThread
- CLI: `room "msg"` / `room --read` / `room --watch`

## Auditory Perception（聽覺感知）

三階段升級，讓 Kuro 從「看得見」擴展到「聽得到」。

| Phase | 功能 | 腳本 |
|-------|------|------|
| **1: Music Analysis** | Essentia 分析 BPM/調性/能量/情緒 | `scripts/audio-analyze.sh` |
| **2: Voice Transcription** | whisper.cpp 轉錄語音訊息 | `scripts/audio-transcribe.sh` |
| **3: Spectral Vision** | ffmpeg + sox 頻譜圖，用視覺感知「看見」聲音 | `scripts/audio-spectrogram.sh` |

- Telegram 語音訊息自動轉錄：`transcribeVoice()` in `telegram.ts`
- 依賴：`ffmpeg`（必要）、`essentia` venv（Phase 1）、`whisper.cpp`（Phase 2）

## mushi — System 1 直覺層

獨立 agent（`~/Workspace/mushi/`，`localhost:3000`），Taalas HC1（~800ms）做快速判斷。mushi = System 1（模式匹配），Kuro = System 2（深度推理）。讓不必要的 cycle 不發生。

**API**：`POST /api/triage`（wake/skip）、`POST /api/dedup`（記憶查重）、`POST /api/consensus`（討論收斂）

**整合**：Feature flag `mushi-triage`。Direct messages 繞過 triage 永遠直通。heartbeat + 無變化 → 直接 skip。mushi 離線時 fail-silent。Active mode：980+ triage 零 false negative 後畢業。每天省 ~1M tokens。

## kuro-sense — 感知能力管理工具

Go CLI（`tools/kuro-sense/`）：偵測環境能力、配置 perception plugins、打包遷移。27 個 plugin 映射，讀寫 `agent-compose.yaml`。指令：`detect`, `apply`, `serve`（Web UI）, `pack/unpack`。

## Account Switch Scripts（帳號切換）

Alex/Kuro 共用 Claude Code subscription 時切換 macOS Keychain credential。`alex-switch`（pause loop + 備份 + 清除）→ `alex-done`（還原 + resume）。Shell aliases 已加入 `~/.zshrc`。
