"""List the configured Ekispert MCP tool names without showing secrets or data."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
AGENT_API_ROOT = REPOSITORY_ROOT / "services" / "agent-api"
if str(AGENT_API_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_API_ROOT))

from agent_api.mobility.ekispert_mcp import EkispertMcpError, EkispertMcpProvider


async def _run(*, dry_run: bool) -> int:
    if dry_run:
        print("EKISPERT_MCP=DRY_RUN")
        return 0

    provider = EkispertMcpProvider()
    if not provider.is_configured():
        print("EKISPERT_MCP=UNCONFIGURED")
        return 0

    try:
        tools = await provider.list_tools()
    except EkispertMcpError as error:
        print(f"EKISPERT_MCP=ERROR reason={error.reason_code}")
        return 1

    print(f"EKISPERT_MCP=OK tools={len(tools)}")
    for tool in tools:
        print(tool.name)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="exit successfully without checking credentials or making a request",
    )
    args = parser.parse_args()
    return asyncio.run(_run(dry_run=args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
