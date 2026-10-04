# 72H — AI Project Context

## Mission

**72H** is an agentic disaster-response assistant designed for foreign visitors and residents in Japan who may receive disaster alerts but still need help deciding what to do next as official information, transport conditions, network availability, and personal circumstances change.

Tagline:

> **From Alert to Action.**

Japanese tagline:

> **警報から、行動へ。**

## Primary MVP User

Initial target:

- foreign visitor in Japan
- unfamiliar with Japanese disaster information and transport systems
- first supported disaster type: **earthquake**
- primary replay scenario: traveler in Shibuya planning to return to accommodation in Asakusa

Supported UI languages for the MVP:

- Japanese
- English
- Traditional Chinese

## Core Product Difference

72H is not primarily an alert-delivery or translation app.

It focuses on:

```text
Alert
→ Verified Situation
→ Personal Context
→ Action Plan
→ Situation Change
→ Plan Invalidation
→ Autonomous Re-plan
```

The user-facing plan is organized into:

- `NOW`
- `NEXT`
- `AVOID`

Every important action must be explainable through source provenance and freshness.

## Agent Topology

### Situation Agent

Maintains semantic understanding of the current situation and identifies meaningful changes.

### Source Agent

Normalizes claims from external information. It does not independently decide source trust.

### Mobility Agent

Evaluates route and transport availability. It must never equate availability with disaster safety.

### Action Agent

Produces structured candidate `NOW / NEXT / AVOID` actions based on eligible evidence and the current situation.

### Deterministic Safety Core

Not a conversational agent. It controls policy decisions such as:

- evidence eligibility
- TTL / freshness
- conflicts
- plan expiration
- dependency invalidation
- high-risk action blocking
- hallucinated evidence-reference rejection
- replay determinism
- offline degradation

## Core Domain Objects

Primary objects are defined in `docs/DATA_MODEL.md`:

- `UserProfile`
- `DisasterEvent`
- `Evidence`
- `Situation`
- `Plan`
- `PlanAction`
- `TraceEvent`
- `ReplaySession`

Plans are versioned. Previous plan versions are never silently overwritten.

## Network Model

Network state is part of the situation.

Expected states include:

```text
ONLINE_VERIFIED
ONLINE_DEGRADED
OFFLINE_RECENT
OFFLINE_STALE
RECONNECTING
```

72H is cloud-powered but offline-survivable.

When offline, the product exposes the Last Verified Plan and explicitly degrades any action that depends on stale live evidence.

## Recommended Technology

Frontend:

- Next.js
- TypeScript
- Tailwind CSS
- PWA service worker
- IndexedDB

Backend:

- Python
- FastAPI
- Google Agent Development Kit
- Gemini

Google Cloud:

- Cloud Run
- Firestore
- Cloud Logging
- Secret Manager
- Vertex AI / Gemini through service identity and ADC where applicable

## External Source Strategy

External data is hidden behind adapters.

Example:

```text
DisasterSource
├── JmaSource
├── SafetyTipsSource
└── ReplaySource

MobilitySource
├── TransportProviderSource
└── ReplayMobilitySource
```

The replay path exists to make judging deterministic while still exercising the real application pipeline.

## Demo Story

The canonical replay demonstrates:

1. traveler has an existing return-to-hotel plan
2. earthquake event is received
3. verified evidence enters the system
4. Plan v1 is generated
5. transport conditions change
6. a plan dependency becomes invalid
7. 72H autonomously invalidates and re-plans
8. unverified social information is rejected as action evidence
9. network connectivity is lost
10. Continuity Mode retains the Last Verified Plan and degrades stale live-dependent actions
11. network returns
12. 72H synchronizes, verifies, reconciles, and re-evaluates
13. source and trace views show observability

## Definition of MVP Success

The MVP succeeds when this chain is real, stable, and inspectable:

```text
Situation
→ Change
→ Autonomous Evaluation
→ Re-plan
→ Explain
```

and continuity is demonstrated through:

```text
Network Lost
→ Last Verified Plan retained
→ freshness continues locally
→ unsafe assumptions degrade
→ Network Restored
→ Sync
→ Verify
→ Re-evaluate
```

## Canonical Documentation

Use the files in `/docs` as the authoritative specification. This `.ai` directory exists to give coding agents a concise operational context, not to replace the full specifications.
