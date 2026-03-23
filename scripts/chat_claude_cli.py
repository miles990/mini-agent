"""
ChatClaudeCLI — browser-use LLM provider that uses Claude CLI instead of direct API calls.

This allows browser-use to work within mini-agent's architecture where Claude CLI
handles authentication via OAuth, eliminating the need for ANTHROPIC_API_KEY.

Usage:
    from chat_claude_cli import ChatClaudeCLI
    from browser_use import Agent

    llm = ChatClaudeCLI(model="claude-sonnet-4-6")
    agent = Agent(task="Go to HN and get top 3 stories", llm=llm)
    result = await agent.run()
"""

import asyncio
import json
import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar, overload

from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError
from browser_use.llm.messages import (
    AssistantMessage,
    BaseMessage,
    SystemMessage,
    UserMessage,
)
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

T = TypeVar("T", bound=BaseModel)

logger = logging.getLogger(__name__)


def _serialize_messages_to_prompt(messages: list[BaseMessage]) -> tuple[str, str | None]:
    """Convert browser-use messages to a single prompt string + optional system prompt.

    Returns (prompt, system_prompt).
    """
    system_parts: list[str] = []
    conversation_parts: list[str] = []

    for msg in messages:
        if isinstance(msg, SystemMessage):
            if isinstance(msg.content, str):
                system_parts.append(msg.content)
            elif isinstance(msg.content, list):
                system_parts.append(
                    " ".join(
                        part.text for part in msg.content if hasattr(part, "text")
                    )
                )

        elif isinstance(msg, UserMessage):
            if isinstance(msg.content, str):
                conversation_parts.append(f"[User]\n{msg.content}")
            elif isinstance(msg.content, list):
                text_parts = []
                for part in msg.content:
                    if hasattr(part, "text"):
                        text_parts.append(part.text)
                    elif hasattr(part, "image_url"):
                        text_parts.append("[Image omitted - vision not supported in CLI mode]")
                if text_parts:
                    conversation_parts.append(f"[User]\n{' '.join(text_parts)}")

        elif isinstance(msg, AssistantMessage):
            if msg.content:
                if isinstance(msg.content, str):
                    conversation_parts.append(f"[Assistant]\n{msg.content}")
                elif isinstance(msg.content, list):
                    text = " ".join(
                        part.text
                        for part in msg.content
                        if hasattr(part, "text")
                    )
                    if text:
                        conversation_parts.append(f"[Assistant]\n{text}")
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    conversation_parts.append(
                        f"[Assistant Tool Call: {tc.function.name}]\n{tc.function.arguments}"
                    )

    system_prompt = "\n\n".join(system_parts) if system_parts else None
    prompt = "\n\n".join(conversation_parts)

    return prompt, system_prompt


@dataclass
class ChatClaudeCLI(BaseChatModel):
    """browser-use LLM provider using Claude CLI (claude -p).

    Uses the locally installed Claude CLI for inference, which handles
    authentication via OAuth. No API key required.
    """

    model: str = "claude-sonnet-4-6"
    max_tokens: int = 8192
    temperature: float | None = None
    cli_path: str = "claude"
    timeout_seconds: int = 120
    max_turns: int = 1
    _verified_api_keys: bool = field(default=True, init=False)

    @property
    def provider(self) -> str:
        return "claude-cli"

    @property
    def name(self) -> str:
        return f"{self.model} (CLI)"

    @overload
    async def ainvoke(
        self,
        messages: list[BaseMessage],
        output_format: None = None,
        **kwargs: Any,
    ) -> ChatInvokeCompletion[str]: ...

    @overload
    async def ainvoke(
        self,
        messages: list[BaseMessage],
        output_format: type[T],
        **kwargs: Any,
    ) -> ChatInvokeCompletion[T]: ...

    async def ainvoke(
        self,
        messages: list[BaseMessage],
        output_format: type[T] | None = None,
        **kwargs: Any,
    ) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
        prompt, system_prompt = _serialize_messages_to_prompt(messages)

        # When using --json-schema, the CLI internally uses tool calling which
        # requires multiple turns (tool_use -> tool_result -> end_turn).
        # We need --max-turns 3 minimum for structured output.
        effective_max_turns = 3 if output_format is not None else self.max_turns

        cmd = [
            self.cli_path,
            "-p",
            "--output-format", "json",
            "--model", self.model,
            "--max-turns", str(effective_max_turns),
        ]

        if output_format is not None:
            # Get JSON schema from Pydantic model
            schema = output_format.model_json_schema()
            schema_str = json.dumps(schema)
            cmd.extend(["--json-schema", schema_str])

        # Write system prompt to temp file to avoid shell argument length limits
        # and ensure proper system/user message separation in the API call
        system_prompt_file = None
        if system_prompt:
            system_prompt_file = tempfile.NamedTemporaryFile(
                mode="w", suffix=".txt", delete=False, encoding="utf-8"
            )
            system_prompt_file.write(system_prompt)
            system_prompt_file.close()
            cmd.extend(["--system-prompt-file", system_prompt_file.name])

        # When structured output is expected, reinforce that the model MUST use the
        # provided JSON schema tool. Without this, the model sometimes answers
        # in plain text instead of structured actions.
        if output_format is not None:
            cmd.extend([
                "--append-system-prompt",
                "CRITICAL: You MUST respond using the provided JSON schema tool. "
                "NEVER respond with plain text. Always use the structured output format.",
            ])

        logger.debug(f"Claude CLI command: {' '.join(cmd[:6])}...")
        logger.debug(f"Prompt length: {len(prompt)} chars, system: {len(system_prompt or '')} chars")

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(input=prompt.encode("utf-8")),
                timeout=self.timeout_seconds,
            )

            if process.returncode != 0:
                error_msg = stderr.decode("utf-8", errors="replace").strip()
                raise ModelProviderError(
                    message=f"Claude CLI exited with code {process.returncode}: {error_msg}",
                    model=self.name,
                )

            raw_output = stdout.decode("utf-8").strip()

            if not raw_output:
                raise ModelProviderError(
                    message="Claude CLI returned empty output",
                    model=self.name,
                )

            # Parse the CLI JSON output (--output-format json wraps in {"result": ..., "cost_usd": ...})
            try:
                cli_response = json.loads(raw_output)
            except json.JSONDecodeError:
                # If not valid JSON, treat as raw text
                cli_response = {"result": raw_output}

            # Log when structured output is expected but missing (aids debugging)
            if output_format is not None and cli_response.get("structured_output") is None:
                logger.debug(
                    f"structured_output missing, will try parsing from result field "
                    f"(stop_reason={cli_response.get('stop_reason')})"
                )

            # Extract usage from CLI response
            cli_usage = cli_response.get("usage", {})
            input_tokens = cli_usage.get("input_tokens", 0)
            output_tokens = cli_usage.get("output_tokens", 0)
            cached_tokens = cli_usage.get("cache_read_input_tokens", None)
            cache_creation = cli_usage.get("cache_creation_input_tokens", None)

            usage = ChatInvokeUsage(
                prompt_tokens=input_tokens,
                completion_tokens=output_tokens,
                total_tokens=input_tokens + output_tokens,
                prompt_cached_tokens=cached_tokens,
                prompt_cache_creation_tokens=cache_creation,
                prompt_image_tokens=None,
            )

            stop_reason = cli_response.get("stop_reason", "end_turn")

            if output_format is None:
                response_text = cli_response.get("result", raw_output)
                if isinstance(response_text, dict):
                    response_text = json.dumps(response_text)
                return ChatInvokeCompletion(
                    completion=response_text,
                    usage=usage,
                    stop_reason=stop_reason,
                )
            else:
                # CLI puts parsed structured output in "structured_output" field
                structured = cli_response.get("structured_output")
                if structured is not None:
                    try:
                        validated = output_format.model_validate(structured)
                        return ChatInvokeCompletion(
                            completion=validated,
                            usage=usage,
                            stop_reason=stop_reason,
                        )
                    except Exception as e:
                        logger.warning(f"structured_output validation failed: {e}")

                # Fallback: try parsing from "result" text
                response_text = cli_response.get("result", "")
                try:
                    if isinstance(response_text, str):
                        parsed_data = json.loads(response_text)
                    else:
                        parsed_data = response_text
                    validated = output_format.model_validate(parsed_data)
                    return ChatInvokeCompletion(
                        completion=validated,
                        usage=usage,
                        stop_reason=stop_reason,
                    )
                except (json.JSONDecodeError, Exception):
                    pass

                # Last resort: extract JSON from text
                json_str = _extract_json(str(response_text))
                if json_str:
                    parsed_data = json.loads(json_str)
                    validated = output_format.model_validate(parsed_data)
                    return ChatInvokeCompletion(
                        completion=validated,
                        usage=usage,
                        stop_reason=stop_reason,
                    )

                raise ModelProviderError(
                    message=f"Failed to parse structured output from CLI response. "
                    f"Result: {str(response_text)[:500]}",
                    model=self.name,
                )

        except asyncio.TimeoutError:
            raise ModelProviderError(
                message=f"Claude CLI timed out after {self.timeout_seconds}s",
                model=self.name,
            )
        except FileNotFoundError:
            raise ModelProviderError(
                message=f"Claude CLI not found at '{self.cli_path}'. Is it installed?",
                model=self.name,
            )
        finally:
            if system_prompt_file:
                Path(system_prompt_file.name).unlink(missing_ok=True)


def _extract_json(text: str) -> str | None:
    """Try to extract a JSON object from text that may contain surrounding content."""
    # Try to find JSON object boundaries
    start = text.find("{")
    if start == -1:
        return None

    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start : i + 1]
                try:
                    json.loads(candidate)
                    return candidate
                except json.JSONDecodeError:
                    continue
    return None
