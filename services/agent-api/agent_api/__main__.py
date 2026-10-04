"""Run the local Phase 1 API."""

import uvicorn


if __name__ == "__main__":
    uvicorn.run("agent_api.main:app", host="127.0.0.1", port=8000, reload=False)
