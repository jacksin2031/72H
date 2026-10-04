"""Run the private API and public Next server in one bounded demo instance."""
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

children: list[subprocess.Popen] = []
VENV_PYTHON = Path("/app/services/agent-api/.venv/bin/python")
API_HEALTH_URL = "http://127.0.0.1:8000/health"


def stop(_signum=None, _frame=None):
    for process in children:
        if process.poll() is None:
            process.terminate()
    for process in children:
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()


def wait_for_api(process: subprocess.Popen, timeout_seconds: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        return_code = process.poll()
        if return_code is not None:
            raise RuntimeError(f"FastAPI exited during startup with code {return_code}")
        try:
            with urllib.request.urlopen(API_HEALTH_URL, timeout=1) as response:
                if response.status == 200:
                    print("FastAPI readiness check passed", flush=True)
                    return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("FastAPI readiness check timed out")


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    if not VENV_PYTHON.is_file():
        raise RuntimeError(f"venv Python missing: {VENV_PYTHON}")
    api = subprocess.Popen(
        [str(VENV_PYTHON), "-m", "uvicorn", "agent_api.main:app", "--host", "127.0.0.1", "--port", "8000", "--workers", "1"],
        cwd="/app/services/agent-api",
    )
    children.append(api)
    wait_for_api(api)
    web = subprocess.Popen(
        ["node", "server.js"],
        cwd="/app/web",
        env={**os.environ, "PORT": os.environ.get("PORT", "8080")},
    )
    children.append(web)
    while all(process.poll() is None for process in children):
        time.sleep(0.5)
    codes = [process.poll() for process in children]
    raise RuntimeError(f"child process exited unexpectedly: {codes}")
finally:
    stop()
