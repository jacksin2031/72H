# 72H

> **From Alert to Action.**  
> **警報から、行動へ。**

72H is a disaster-action AI agent designed for people in Japan who may not be familiar with local disaster information, transport conditions, or emergency procedures.

The project focuses on one question:

> **After receiving an alert, what should I do next?**

72H combines verified disaster information, transport conditions, the user's current situation, and an agentic planning loop to maintain an actionable plan as conditions change.

## Core concept

```text
Observe
  ↓
Verify
  ↓
Understand
  ↓
Plan
  ↓
Monitor
  ↓
Detect Change
  ↓
Re-plan
```

72H is not intended to predict disasters or replace official emergency instructions. High-impact recommendations must be traceable to eligible evidence. When the network is unavailable, 72H enters Continuity Mode and falls back to the last verified plan and preloaded emergency information rather than inventing new real-time guidance.

## Hackathon scope

Primary v0.1 scenario:

- Disaster: Earthquake
- User: Foreign visitor in Tokyo
- Current location: Shibuya
- Accommodation: Asakusa
- Original plan: Return to accommodation at 18:00
- Languages: Japanese / English / Traditional Chinese

## Key capabilities

- Verified disaster evidence ingestion
- Situation state management
- `NOW / NEXT / AVOID` action plans
- Plan versioning and expiration
- Situation change detection
- Automatic plan invalidation and re-planning
- Source provenance and freshness tracking
- Unverified information rejection
- Agent activity trace
- Deterministic disaster replay for judging/demo
- Offline Continuity Mode
- Last Verified Plan
- Offline Emergency Pack

## Safety principles

1. **No Source → No High-Risk Action**
2. Route availability does not mean route safety.
3. Unverified information cannot directly drive high-risk actions.
4. Stale information must be visibly downgraded.
5. A changed dependency can invalidate a plan.
6. The system must never present LLM inference as official information.
7. When offline, the system must state what it no longer knows.

## Planned stack

- Next.js / TypeScript
- Python / FastAPI
- Gemini
- Google Agent Development Kit (ADK)
- Google Cloud Run
- Firestore
- Cloud Logging
- PWA / Service Worker / IndexedDB for offline continuity

## Documentation

- [Product Specification](docs/PRODUCT_SPEC.md)
- [Replay Scenario](docs/REPLAY_SCENARIO.md)
- [Agent & Safety Contract](docs/AGENT_SAFETY_CONTRACT.md)
- [Offline Continuity Specification](docs/OFFLINE_CONTINUITY.md)
- [Architecture](docs/ARCHITECTURE.md)

## Status

Design phase — Hackathon MVP specification in progress.
