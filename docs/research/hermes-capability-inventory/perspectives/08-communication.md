# Hermes Agent - Communication Channels

Sources:
- gateway/run.py - GatewayRunner, message dispatch
- gateway/platforms/ - Platform adapters
- hermes_cli/main.py - CLI entry point
- acp_adapter/ - VS Code/Zed/JetBrains integration
- gateway/platforms/api_server.py - OpenAI-compatible API server

## Platform Inventory

### 1. Interactive CLI (hermes_cli/)
Entry: cli.py HermesCLI class, hermes_cli/main.py

Features:
- Rich terminal UI with KawaiiSpinner (animated, tool-preview in spinner text)
- Prompt toolkit for readline-style input with history + tab completion
- Slash commands: /skill-name, /plan, /model, /settings, /reset, /help, /profile, /sessions, /insights, /skin, /tools, /skills
- Skin engine: YAML-configurable visual themes (colors, spinner animations, branding)
- Copy to clipboard integration
- Session continuity across restarts

### 2. Telegram Bot
File: gateway/platforms/telegram.py

Personal use. Full tool access. Send_message can target specific topics (chat_id:thread_id).
Handles media (images, voice, documents) as tool inputs.
Long messages split at Telegram's 4096-char limit.

### 3. Discord Bot
File: gateway/platforms/discord.py

Full tool access. Dangerous command approval via Discord buttons/reactions.
Message splitting for long responses. Markdown formatting.

### 4. Slack Bot
File: gateway/platforms/slack.py

Full tool access. Workspace use.

### 5. WhatsApp
File: gateway/platforms/whatsapp.py

Personal messaging. Full tool access. (More trusted context than team/public channels.)

### 6. Signal
File: gateway/platforms/signal.py

Encrypted messaging. Full tool access.

### 7. Email (IMAP/SMTP)
File: gateway/platforms/email.py

Full tool access. Interact with Hermes via email.

### 8. Mattermost
File: gateway/platforms/mattermost.py

Self-hosted team messaging. Full tool access.

### 9. Matrix
File: gateway/platforms/matrix.py

Decentralized encrypted messaging. Full tool access.

### 10. DingTalk
File: gateway/platforms/dingtalk.py

Enterprise messaging (Alibaba). Full tool access.

### 11. Feishu/Lark
File: gateway/platforms/feishu.py

Enterprise messaging (ByteDance). Full tool access.

### 12. WeCom (Enterprise WeChat)
File: gateway/platforms/wecom.py

Enterprise WeChat. Full tool access.

### 13. SMS (Twilio)
File: gateway/platforms/sms.py

Text messaging via Twilio. Full tool access.

### 14. Webhooks
File: gateway/platforms/webhook.py

Receive and process external webhook events.

### 15. Home Assistant
File: gateway/platforms/homeassistant.py

Smart home event monitoring. Triggers agent on HA events. Full tool access including ha_* tools.

### 16. VS Code / Zed / JetBrains (ACP)
Directory: acp_adapter/

Agent Communication Protocol adapter. Editor integration without messaging/audio tools.
Toolset: hermes-acp (no clarify, no TTS, no messaging).

### 17. OpenAI-Compatible API Server
File: gateway/platforms/api_server.py

HTTP server exposing Hermes as an OpenAI-compatible endpoint. No interactive UI tools (clarify, send_message).
Toolset: hermes-api-server.

## Gateway Architecture

GatewayRunner in gateway/run.py orchestrates all platform adapters.

Key design decisions:
- Each platform adapter runs its own async event loop (Telegram uses python-telegram-bot, Discord uses discord.py, etc.)
- All converge to a common message dispatch path: _handle_message()
- Session management: SessionStore (gateway/session.py) keeps conversation history per platform+user. Each new message loads existing history.
- Each message creates a fresh AIAgent but passes conversation_history from SessionStore. The AIAgent reloads the stored system_prompt from SessionDB for prefix cache preservation.
- Slash commands are handled at the gateway level before passing to AIAgent. Platform-agnostic (same /reset, /profile, /model commands work on all platforms).
- send_message tool: cross-platform outbound messaging. Platform adapters register their send functions in channel_directory. Agent can send to any connected platform from any context.

## Session Persistence for Multi-Turn

gateway/session.py SessionStore:
- Stores conversation messages per platform+channel per user
- TTL-based expiry
- Reconnects properly when Hermes restarts mid-conversation

hermes_state.py SessionDB:
- SQLite with FTS5
- Stores all sessions + messages for recall via session_search
- Stores system_prompt per session for prefix cache restoration

## Engineering Quality

- Platform coverage: exceptional. 17 channels including niche enterprise platforms (DingTalk, Feishu, WeCom).
- Unified core: all platforms use the same AIAgent core with platform-specific toolsets.
- send_message tool: the agent can reach out to ANY connected platform from ANY context. Bidirectional.
- ACP adapter: clean separation from chat platforms. Editor integration gets coding-focused toolset.
- API server: makes Hermes a drop-in replacement for any OpenAI-compatible client.
- Session persistence across restarts: critical for real-world use.
- Prefix cache preservation across messages: sophisticated. Requires system_prompt in DB + reload on new AIAgent.
- Worth absorbing: gateway session pattern (new agent per message, reload history), cross-platform send_message as a first-class tool, platform-specific toolsets with shared core.
