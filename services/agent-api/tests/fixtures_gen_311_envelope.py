"""Regenerate apps/web/tests/fixtures/mock-live-311-*.json from the real Mock Live API.

Run from the repo root:
  uv run --project services/agent-api python services/agent-api/tests/fixtures_gen_311_envelope.py
No real model is called (a fixed UNKNOWN runner stands in for Gemini).
The synthetic tsunami source gets a strictly increasing clock (never ahead of the wall clock), so the step-3
UPDATE always sorts after the step-2 ISSUE and gets its own plan version, as on a fine-grained clock.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_historical_tsunami import HEADERS, KEY, _client, _next, _start  # noqa: E402

from agent_api import mock_live  # noqa: E402

OUT = Path(__file__).resolve().parents[3] / "apps" / "web" / "tests" / "fixtures"


def strictly_increasing_clock():
    last = [datetime.min.replace(tzinfo=timezone.utc)]

    def now() -> datetime:
        while (value := datetime.now(timezone.utc)) <= last[0]:
            time.sleep(0.001)
        last[0] = value
        return value
    return now


def main() -> None:
    os.environ["DRILL_ACCESS_KEY"] = KEY
    original = mock_live.MockTsunamiSource.__init__
    clock = strictly_increasing_clock()
    mock_live.MockTsunamiSource.__init__ = lambda self, jma=None, *, now=None: original(self, jma, now=now or clock)
    with _client() as client:
        sid = _start(client)
        for _ in range(4):
            final = _next(client, sid)
            time.sleep(0.02)  # a later stage is always published at a later instant
        after = client.post(f"/api/mock-live/{sid}/distress", headers=HEADERS,
                            json={"tags": ["WATER_RISING"], "input_mode": "BUTTON"}).json()
    for name, data in (("mock-live-311-final.json", final), ("mock-live-311-after-report.json", after)):
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("generated", datetime.now(timezone.utc).isoformat())


if __name__ == "__main__":
    main()
