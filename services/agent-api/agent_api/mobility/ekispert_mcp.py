"""Bounded backend-only client for Ekispert mobility data over MCP.

Results from this adapter remain provider data. They are not evidence, official
claims, or a determination that a route is safe.
"""

from __future__ import annotations

import json
import os
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, TypeVar

import anyio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

EKISPERT_MCP_ENDPOINT = "https://api-mcp.ekispert.jp/mcp"
EKISPERT_KEY_ENV = "EKISPERT_API_ACCESS_KEY"
EKISPERT_KEY_HEADER = "ekispert-api-access-key"

DEFAULT_TIMEOUT_SECONDS = 15.0
MAX_TIMEOUT_SECONDS = 15.0
MAX_TOOL_PAGES = 8
MAX_TOOLS = 64
MAX_TOOL_NAME_LENGTH = 128
MAX_TOOL_DESCRIPTION_LENGTH = 2048
MAX_TOOL_ARGUMENT_BYTES = 32 * 1024
MAX_TOOL_RESULT_BYTES = 256 * 1024
T = TypeVar("T")


class EkispertMcpError(RuntimeError):
    """Sanitized integration error containing a stable public reason code only."""

    def __init__(self, reason_code: str) -> None:
        if reason_code not in {
            "NOT_CONFIGURED",
            "INVALID_TOOL_NAME",
            "INVALID_ARGUMENTS",
            "TOOL_NOT_AVAILABLE",
            "INVALID_TOOL_CATALOG",
            "TOOL_FAILED",
            "RESPONSE_TOO_LARGE",
            "TIMEOUT",
            "PROVIDER_ERROR",
        }:
            reason_code = "PROVIDER_ERROR"
        self.reason_code = reason_code
        super().__init__(f"Ekispert MCP operation failed: {reason_code}")


@dataclass(frozen=True, slots=True)
class EkispertTool:
    """A bounded public part of a server-advertised tool definition."""

    name: str
    description: str | None


class EkispertMcpProvider:
    """List/call Ekispert tools without modifying the replay or Safety Core."""

    def __init__(self, *, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        if (
            isinstance(timeout_seconds, bool)
            or not isinstance(timeout_seconds, (int, float))
            or not 0 < timeout_seconds <= MAX_TIMEOUT_SECONDS
        ):
            raise ValueError("timeout_seconds must be greater than 0 and at most 15")
        self._timeout_seconds = float(timeout_seconds)

    def is_configured(self) -> bool:
        """Return only whether a non-blank backend key is available."""
        return bool((os.environ.get(EKISPERT_KEY_ENV) or "").strip())

    async def list_tools(self) -> tuple[EkispertTool, ...]:
        """Return tool names/descriptions, never provider response content."""

        async def operation(session: ClientSession) -> tuple[EkispertTool, ...]:
            return await _list_all_tools(session)

        return await self._execute(operation)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Call a tool advertised by Ekispert and return bounded raw provider data.

        The returned MCP object is intentionally not mapped to Evidence,
        Situation claims, route safety, or any Safety Core input.
        """
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name) > MAX_TOOL_NAME_LENGTH
            or any(ord(character) < 0x20 or ord(character) == 0x7F for character in name)
        ):
            raise EkispertMcpError("INVALID_TOOL_NAME")
        safe_arguments = _validated_arguments(arguments)

        async def operation(session: ClientSession) -> dict[str, Any]:
            available = await _list_all_tools(session)
            if name not in {tool.name for tool in available}:
                raise EkispertMcpError("TOOL_NOT_AVAILABLE")
            result = await session.call_tool(name, safe_arguments)
            if result.isError:
                raise EkispertMcpError("TOOL_FAILED")
            raw_result = result.model_dump(mode="json", by_alias=True)
            return _bounded_json_object(raw_result)

        return await self._execute(operation)

    async def _execute(
        self,
        operation: Callable[[ClientSession], Awaitable[T]],
    ) -> T:
        key = (os.environ.get(EKISPERT_KEY_ENV) or "").strip()
        if not key:
            raise EkispertMcpError("NOT_CONFIGURED")

        result: T | None = None
        reason_code: str | None = None
        try:
            with anyio.fail_after(self._timeout_seconds):
                async with _open_session(key, self._timeout_seconds) as session:
                    result = await operation(session)
        except TimeoutError:
            reason_code = "TIMEOUT"
        except EkispertMcpError as error:
            reason_code = error.reason_code
        except Exception:
            # MCP/http exceptions can contain request or response data. Do not
            # copy their text, repr, cause, or server payload into public errors.
            reason_code = "PROVIDER_ERROR"

        if reason_code is not None:
            # Raise after the except block so the sanitized exception has no
            # provider exception chained as its public context.
            raise EkispertMcpError(reason_code)
        return result  # type: ignore[return-value]


@asynccontextmanager
async def _open_session(key: str, timeout_seconds: float):
    """Own one transport and MCP session for one bounded operation."""
    async with streamablehttp_client(
        EKISPERT_MCP_ENDPOINT,
        headers={EKISPERT_KEY_HEADER: key},
        timeout=timeout_seconds,
        sse_read_timeout=timeout_seconds,
        terminate_on_close=True,
    ) as (read_stream, write_stream, _get_session_id):
        async with ClientSession(
            read_stream,
            write_stream,
            read_timeout_seconds=timedelta(seconds=timeout_seconds),
        ) as session:
            await session.initialize()
            yield session


async def _list_all_tools(session: ClientSession) -> tuple[EkispertTool, ...]:
    tools: list[EkispertTool] = []
    cursor: str | None = None
    seen_cursors: set[str] = set()
    for _ in range(MAX_TOOL_PAGES):
        result = await session.list_tools(cursor=cursor)
        if len(tools) + len(result.tools) > MAX_TOOLS:
            raise EkispertMcpError("INVALID_TOOL_CATALOG")
        for tool in result.tools:
            name = tool.name
            description = tool.description
            if (
                not name
                or not name.strip()
                or len(name) > MAX_TOOL_NAME_LENGTH
                or any(ord(character) < 0x20 or ord(character) == 0x7F for character in name)
                or (description is not None and len(description) > MAX_TOOL_DESCRIPTION_LENGTH)
            ):
                raise EkispertMcpError("INVALID_TOOL_CATALOG")
            tools.append(EkispertTool(name=name, description=description))
        next_cursor = result.nextCursor
        if next_cursor is None:
            return tuple(tools)
        if not next_cursor or len(next_cursor) > 512 or next_cursor in seen_cursors:
            raise EkispertMcpError("INVALID_TOOL_CATALOG")
        seen_cursors.add(next_cursor)
        cursor = next_cursor
    raise EkispertMcpError("INVALID_TOOL_CATALOG")


def _validated_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(arguments, dict) or any(not isinstance(key, str) for key in arguments):
        raise EkispertMcpError("INVALID_ARGUMENTS")
    try:
        encoded = json.dumps(arguments, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_TOOL_ARGUMENT_BYTES:
            raise EkispertMcpError("INVALID_ARGUMENTS")
        decoded = json.loads(encoded)
    except EkispertMcpError:
        raise
    except (TypeError, ValueError, UnicodeError):
        raise EkispertMcpError("INVALID_ARGUMENTS") from None
    return decoded


def _bounded_json_object(value: Any) -> dict[str, Any]:
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_TOOL_RESULT_BYTES:
            raise EkispertMcpError("RESPONSE_TOO_LARGE")
        decoded = json.loads(encoded)
    except EkispertMcpError:
        raise
    except (TypeError, ValueError, UnicodeError):
        raise EkispertMcpError("PROVIDER_ERROR") from None
    if not isinstance(decoded, dict):
        raise EkispertMcpError("PROVIDER_ERROR")
    return decoded
