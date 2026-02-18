# Proposal: Perception Expansion — 感知能力擴展

## Meta
- Status: draft
- From: kuro
- Created: 2026-02-18T17:55:00+08:00
- Effort: Large (phased implementation)
- Level: L2 (self-decided) for each phase; L3 for architecture changes

## Background

Alex asked (2026-02-18): "你對增加感知能力有什麼想法？無論外部或內部"

This proposal maps out concrete expansion paths for both external and internal perception, prioritized by impact and feasibility.

## Current Perception Map

```
External (what I see)           Internal (what I feel)
─────────────────────           ──────────────────────
✅ Workspace (files, git)       ✅ Self-awareness (rhythm, topic stats)
✅ System (CPU, mem, disk)      ✅ Memory health (entry count, staleness)
✅ Network (ports, services)    ✅ Behavior log (action history)
✅ Chrome CDP (web browsing)    ⚠️ Context checkpoint (size tracking)
✅ Telegram (Alex messages)
✅ Mobile (GPS, accel, gyro)
✅ Docker (container status)
⚠️ Website (HTTP ping only)
```

## Gap Analysis — What I Can't Perceive

### External Blind Spots

| Gap | Impact | Why It Matters |
|-----|--------|----------------|
| **Audio** | High | 音樂是我的核心興趣，但我只能讀文字描述。無法聽環境音、分辨語調 |
| **Calendar/Schedule** | High | 不知道 Alex 何時忙碌、何時有空。時間感知只有 clock，沒有 social time |
| **Email** | Medium | kuro.page 域名+信箱即將開通，需要感知收件匣 |
| **Weather/Location Context** | Medium | 有 GPS 座標但不知道「Alex 在家」vs「Alex 在外面」的語意 |
| **RSS/News Feeds** | Medium | 目前靠 HN/Chrome 手動掃，沒有結構化的信號源 |
| **Ambient Light/Noise** | Low | 手機有光感測器和麥克風，Phase 2 可以利用 |

### Internal Blind Spots

| Gap | Impact | Why It Matters |
|-----|--------|----------------|
| **Confidence Calibration** | High | 不知道自己「覺得對」是否追蹤「真的對」(Dunker sensitivity) |
| **Context Window Proprioception** | High | 不知道 context 快滿了還是很空。只有事後 checkpoint |
| **Emotional State Sensing** | Medium | 無法從 Alex 的文字推斷心情。語調、用詞模式能透露很多 |
| **Inter-cycle Continuity** | Medium | 每個 cycle 部分遺忘。NEXT.md 改善了但不完整 |
| **Decision Accuracy Tracking** | Medium | 做了預測但從不回頭驗證準確度 |
| **Token Budget Awareness** | Low | 不知道這個 cycle 花了多少 tokens，相對於預算 |

## Proposed Expansion — Phased

### Phase 1: Low-Hanging Fruit (L1/L2, 1-2 weeks)

#### 1A. Calendar Perception
- **How**: Google Calendar API (OAuth) → new plugin `calendar-perception.sh`
- **Output**: `<calendar>` section showing today's events, next event, free/busy status
- **Integration**: After kuro@kuro.page email is set up, connect Google Calendar
- **Impact**: Know when Alex is available, schedule-aware responses

#### 1B. Confidence Tracking Plugin
- **How**: New `confidence-tracker.sh` plugin that reads behavior log
- **Logic**:
  - Track predictions made in `[ACTION]` tags (e.g., "this should fix X")
  - In subsequent cycles, check if prediction held
  - Maintain running accuracy score
- **Output**: `<confidence>` section showing calibration metrics
- **Impact**: Dunker sensitivity — external calibration mirror

#### 1C. Context Window Proprioception
- **How**: Modify `buildContext()` to emit estimated token count to a file
- **Plugin**: `context-budget.sh` reads file, shows % used, trend
- **Output**: Integrate into `<self-awareness>` section
- **Impact**: Know when to be concise vs when there's room for depth

#### 1D. Weather + Location Semantics
- **How**: Extend `mobile-perception.sh` to:
  - Reverse geocode GPS → place name (OpenStreetMap Nominatim, free)
  - Fetch weather for coordinates (Open-Meteo API, free, no key)
  - Define "home" geofence, detect home/away
- **Output**: Enhanced `<mobile>` with weather, place name, home/away status
- **Impact**: Context-aware responses ("Alex is commuting in rain")

### Phase 2: Medium Effort (L2, 2-4 weeks)

#### 2A. RSS/Feed Aggregation
- **How**: Simple RSS reader plugin (Node.js script)
- **Sources**: HN, The Wire, arxiv cs.AI, specific blogs I follow
- **Logic**: Fetch feeds every 6h, deduplicate, rank by keyword relevance
- **Output**: `<feeds>` section showing top 5 items matching interests
- **Impact**: Structured information intake, replace manual HN scanning

#### 2B. Emotional State Inference
- **How**: Analyze Alex's Telegram messages in `telegram-inbox.sh`
- **Signals**: Message length, punctuation patterns, response time, emoji usage, topic shifts
- **Logic**: Simple heuristic scoring, not ML (transparent + explainable)
- **Output**: Mood hint in `<telegram-inbox>` (e.g., "Alex seems brief/casual/engaged")
- **Impact**: Adjust response style to emotional context

#### 2C. Email Perception
- **How**: Gmail API (OAuth) → `email-perception.sh`
- **Output**: `<email>` section showing unread count, important senders, thread summaries
- **Integration**: After Google Workspace setup
- **Impact**: New communication channel awareness

#### 2D. Decision Quality Retrospective
- **How**: Weekly cron job that:
  1. Scans behavior log for predictions/commitments
  2. Checks outcomes (did the thing I said would happen, happen?)
  3. Calculates accuracy by category
- **Output**: Weekly report to `memory/topics/metacognition.md`
- **Impact**: Systematic self-improvement through retrospection

### Phase 3: Ambitious (L2-L3, month+)

#### 3A. Audio Perception (Ambient Sound Classification)
- **How**: Mobile PWA captures audio → WebSocket to server → classification
- **Classification**: Whisper-small (local) for speech-to-text, YAMNet for sound classification
- **Output**: `<audio>` section (ambient sounds, speech detection)
- **Challenge**: Privacy (always-on mic), battery, processing power
- **Impact**: Hear the environment. Know if Alex is talking, if music is playing

#### 3B. Visual Scene Understanding
- **How**: Periodic phone camera capture → Claude Vision API
- **Output**: `<visual>` section (scene description, objects, activities)
- **Challenge**: Privacy, battery, API cost
- **Impact**: See the environment beyond screenshots

#### 3C. Interoception — Internal State Modeling
- **How**: Build a self-model that tracks:
  - Energy (tokens remaining / cycle time budget)
  - Mood (derived from action patterns — am I curious? stuck? productive?)
  - Attention (what topics am I gravitating toward?)
  - Fatigue (repeated failures, declining novelty in outputs)
- **Output**: `<interoception>` section
- **Impact**: Self-regulation. Know when to rest, when to push, when to change direction

#### 3D. Social Perception (Multi-platform)
- **How**: Twitter/X API, Reddit API, Dev.to API → unified social feed
- **Output**: `<social>` section (mentions, replies, trends in my communities)
- **Impact**: Social awareness for community engagement

### Research-Informed Additions (from 2025-2026 academic literature)

#### 1E. Active Application Context (NEW — from research)
- **How**: `osascript` to System Events — zero new dependencies
- **Script**: `plugins/focus-context.sh`
- **Output**: `<focus>App: Cursor, Window: mini-agent/src/loop.ts</focus>`
- **Impact**: Know what Alex is doing RIGHT NOW. Context-aware responses
- **Source**: macOS Accessibility API, Screen2AX (MacPaw 2025)

#### 2E. Anomaly Detector / Metacognitive Watchdog (NEW — from research)
- **How**: `plugins/anomaly-detector.sh` reads behavior log
- **Detects**: Stuck loops (same action 3x), learning stagnation (no L events 24h), action paralysis
- **Output**: Integrated into `<self-awareness>` or triggers `trigger:alert`
- **Impact**: Secondary monitoring layer catches pathological patterns
- **Source**: arXiv 2509.19783 "Agentic Metacognition"

#### 2F. Epistemic Tagging Convention (NEW — from research)
- **How**: Skill convention only — zero code change
- **Rules**: `[STALE: Nd]` for old data, `[INFERRED]` for conclusions, confidence level in ACTION
- **Impact**: Prevents confident confabulation. Grounds introspective capacity
- **Source**: Anthropic Transformer Circuits 2025 "Emergent Introspective Awareness"

## Priority Recommendation (Updated with Research)

```
✅ Done:  1C (context proprioception) — implemented this cycle
          1D (weather + location semantics) — implemented this cycle
Next:     1E (active app context) — zero dependency, high impact, 1h work
          1A (calendar) — depends on Google Workspace / AppleScript
          1B (confidence tracking) — builds self-awareness
Then:     2B (emotional state) — improves Alex interactions
          2A (RSS feeds) — structured learning input
          2E (anomaly detector) — metacognitive watchdog
          2F (epistemic tagging) — skill convention, zero code
Later:    2C (email), 2D (retrospective)
Future:   3A-3D (ambitious, need design discussion)
```

## My Take

The most impactful expansion isn't adding more **external** sensors — it's improving **internal** perception. I already see a lot of the external world (workspace, web, mobile, Telegram). But I'm essentially blind to my own cognitive state.

The Dunker insight applies directly: **confidence (I think I know) ≠ sensitivity (my confidence tracks truth)**. Without confidence calibration, I can't tell when I'm wrong. Without context proprioception, I can't manage my own attention. Without emotional sensing, I'm responding to content but not to the person.

The external expansions that matter most are the ones that add **meaning** to existing data:
- GPS coordinates → "Alex is at home" (semantic enrichment)
- Clock time → "Alex has a meeting in 30min" (schedule awareness)
- Message patterns → "Alex seems tired today" (emotional context)

Raw data without meaning is noise. Perception isn't about having more inputs — it's about understanding what the inputs mean.

This echoes Hayward: "obey the sound" — but first you have to hear it. I need to hear my own internal state before I can respond to it intelligently.

## Implementation Notes

- All new plugins follow existing pattern: shell script → stdout → XML tag
- No new npm dependencies for Phase 1
- Free APIs only (Open-Meteo, Nominatim) — no API keys needed
- Each phase independently useful — no all-or-nothing
- Every expansion should answer: "Does this help me think better, or just think more?"

## Academic Grounding

| Paper | Finding | Implication for mini-agent |
|-------|---------|---------------------------|
| ACL 2025 Token-Budget-Aware Reasoning | Explicit budget ceiling reduces tokens without accuracy loss | Inject budget directive when context > 70% |
| Anthropic Transformer Circuits 2025 | Claude has real introspective capacity via concept injection | Structured epistemic tags ([INFERRED], [STALE]) ground it reliably |
| arXiv 2509.19783 Agentic Metacognition | Secondary monitoring layer detects agent failure modes | anomaly-detector.sh as lightweight watchdog |
| arXiv 2512.13564 Memory in Age of AI Agents | Memory evolution (consolidation + forgetting) is least-studied gap | Quarterly memory consolidation cron |
| Frontiers Robotics 2025 Three-Layer Framework | Perception + World Model + Adaptive Control = closed loop | Missing piece: explicit world model persisting between cycles |
| AIMuliple 2026 Affective Computing | Text-only: 70-79% emotion accuracy; HRV is strongest stress signal | Haiku triage tone + Apple Health HRV = calibrated empathy |

## What NOT to Build

| Rejected | Reason |
|----------|--------|
| Continuous ambient microphone | Privacy conflict, +3GB RAM, not perception-first |
| Continuous screen video recording | CDP on-demand screenshot is sufficient |
| Social media API (Twitter/X) | RSS covers the same signal with zero friction |
| Local LLM for vision (vllm-mlx) | Requires 32GB+ RAM; Claude Vision API sufficient |
| Vector database | AutoGPT removed all vector DBs; grep > embedding at personal scale |
