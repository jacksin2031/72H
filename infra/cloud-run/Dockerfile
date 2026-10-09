# Build from the repository root: docker build -f infra/cloud-run/Dockerfile .
FROM node:24-bookworm-slim AS web-build
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
COPY apps/web/scripts/prepare-map-worker.mjs apps/web/scripts/prepare-area-worker.mjs apps/web/scripts/prepare-workers.mjs ./scripts/
COPY apps/web/scripts/area-worker.mjs ./scripts/
COPY apps/web/lib/area-geometry.ts ./lib/
COPY apps/web/public/areas/manifest.json ./public/areas/
RUN npm ci --no-audit --no-fund
COPY apps/web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.11-slim-bookworm AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.11.12 /uv /uvx /bin/
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=web-build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY packages/contracts/ ./packages/contracts/
COPY services/agent-api/ ./services/agent-api/
ENV UV_PYTHON_DOWNLOADS=never
RUN uv sync --project services/agent-api --frozen --no-dev
RUN /app/services/agent-api/.venv/bin/python -c "import agent_api, uvicorn"
COPY scenarios/ ./scenarios/
COPY --from=web-build /web/.next/standalone ./web/
COPY --from=web-build /web/.next/static ./web/.next/static/
COPY --from=web-build /web/public ./web/public/
COPY infra/cloud-run/entrypoint.py ./entrypoint.py
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser
ENV PORT=8080 HOSTNAME=0.0.0.0 API_BASE_URL=http://127.0.0.1:8000 NEXT_TELEMETRY_DISABLED=1
ENV PATH="/app/services/agent-api/.venv/bin:$PATH"
EXPOSE 8080
CMD ["python", "/app/entrypoint.py"]
