# Hermes Agent - Configuration System

Sources:
- hermes_cli/config.py - Config management, DEFAULT_CONFIG, OPTIONAL_ENV_VARS
- cli-config.yaml.example - Full documented example config
- .env.example - All supported env vars
- hermes_constants.py - get_hermes_home()
- hermes_cli/profiles.py - Multi-profile support

## Config Files

~/.hermes/config.yaml - All settings (model, toolsets, terminal, compression, memory, skills, security, etc.)
~/.hermes/.env - API keys and secrets
~/.hermes/SOUL.md - Agent personality / base system prompt (user-editable)

HERMES_HOME env var overrides the ~/.hermes base directory.
HERMES_PROFILE env var selects a profile subdirectory.

## config.yaml Structure (key sections)

model:
  model_name: string (e.g. "hermes-3-llama-3.1-70b")
  provider: string (openrouter, nous, anthropic, openai, zai, kimi-coding, etc.)
  base_url: string (custom OpenAI-compatible endpoint)
  context_length: int (explicit override)

toolsets: list of toolset names to enable

terminal:
  env: local|docker|ssh|modal|daytona|singularity
  # Backend-specific settings per backend type

compression:
  enabled: bool (default true)
  threshold: float (default 0.50)
  summary_model: string (optional, uses auxiliary client if unset)
  target_ratio: float (default 0.20)
  protect_last_n: int (default 20)

memory:
  enabled: bool
  user_profile: bool
  nudge_interval: int (default 10)
  provider: string (plugin name, e.g. "honcho")

skills:
  creation_nudge_interval: int (default 10)
  # Per-platform skill enable/disable lists

security:
  tirith_enabled: bool (default true)
  tirith_path: string (default "tirith")
  tirith_timeout: int (default 5)
  tirith_fail_open: bool (default true)

delegation:
  provider: string
  model: string
  base_url: string
  api_key: string
  max_iterations: int (default 50)

agent:
  tool_use_enforcement: "auto"|true|false|list

auxiliary:
  provider: string (override for all auxiliary tasks)
  compression:
    provider: string
    model: string
    timeout: int
  vision:
    provider: string
    model: string
    base_url: string
    api_key: string
  web_extract:
    provider: string
    model: string
  session_search:
    provider: string
    model: string

routing:
  enabled: bool
  cheap_model:
    provider: string
    model: string
  max_simple_chars: int (default 160)
  max_simple_words: int (default 28)

mcp_servers:
  server_name:
    command: string
    args: list
    env: dict
    url: string (alternative to command for HTTP transport)
    timeout: int
    sampling:
      enabled: bool
      model: string
      max_tokens_cap: int
      timeout: int

website_blocklist:
  enabled: bool
  domains: list

custom_providers:
  - base_url: string
    models:
      model-name:
        context_length: int

plugins:
  disabled: list of plugin names

## SOUL.md - Personality File

Default: "You are Hermes Agent, an intelligent AI assistant created by Nous Research. You are helpful, knowledgeable, and direct..."

Injected as the first part of the system prompt. User can edit freely to change personality, behavior, or add permanent instructions.

## Multi-Profile Support (hermes_cli/profiles.py)

HERMES_HOME can be set to a profile-specific directory (e.g. ~/.hermes/profiles/work/).
Profiles have independent: config.yaml, .env, SOUL.md, memories/, skills/, sessions.db.

hermes --profile work switches to a specific profile.

## NixOS / Managed Mode

HERMES_MANAGED env var or ~/.hermes/.managed marker file.
In managed mode: config files are system-managed, interactive editing is disabled.
get_managed_update_command() returns correct upgrade command for brew/NixOS.

## Plugin System (hermes_cli/plugins.py)

Discovery from three sources:
1. ~/.hermes/plugins/<name>/ (user plugins)
2. ./.hermes/plugins/<name>/ (project plugins, opt-in via HERMES_ENABLE_PROJECT_PLUGINS)
3. Python entry point group hermes_agent.plugins (pip-installed plugins)

Each plugin: plugin.yaml manifest + __init__.py with register(ctx) function.

Lifecycle hooks: pre_tool_call, post_tool_call, pre_llm_call, post_llm_call, on_session_start, on_session_end.

Plugins can: register tools (via PluginContext.register_tool() -> tools.registry.register()), register memory providers, add slash commands.

## Engineering Quality

- SOUL.md as personality file: excellent UX. Plain markdown, no YAML syntax needed. Easy to customize.
- Config + .env separation: clean. .env for secrets, config.yaml for settings.
- Per-profile isolation: full isolation. Skills, memory, sessions all profile-scoped.
- Auxiliary client overrides: granular. Can use different provider for compression vs vision vs web extraction.
- NixOS managed mode: thoughtful. Respects package manager ownership.
- Plugin lifecycle hooks: minimal but sufficient. pre/post tool and LLM call hooks cover most extension needs.
- Default fail-open for security (tirith_fail_open): pragmatic choice.
- custom_providers with per-model context_length: enables local model support.
- Worth absorbing: SOUL.md pattern, profile isolation, granular auxiliary provider overrides, plugin hook system.
