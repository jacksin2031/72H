"""Run the private API and public Next server in one bounded demo instance."""
import os
import signal
import subprocess
import sys
import time

children: list[subprocess.Popen] = []


def stop(_signum=None, _frame=None):
    for process in children:
        if process.poll() is None:
            process.terminate()
    for process in children:
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    children.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "agent_api.main:app", "--host", "127.0.0.1", "--port", "8000", "--workers", "1"], cwd="/app/services/agent-api"))
    children.append(subprocess.Popen(["node", "server.js"], cwd="/app/web", env={**os.environ, "PORT": os.environ.get("PORT", "8080")}))
    while all(process.poll() is None for process in children):
        time.sleep(0.5)
    sys.exit(1)
finally:
    stop()
