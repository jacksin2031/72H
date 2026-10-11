# 72H P1.8 — Full-screen historical simulation

The test setup screen now launches a separate simulation home at /simulation. The screen uses the 72H mobile visual layout with a simulated clock, a countdown, real Mock Live action text, and four in-app tabs: Home, Plan, Timeline, Settings.

The 311 accelerated default starts at 13:46 JST and advances to 14:46 JST at 600x (about six seconds in real time), then switches to 1x. No Mock Live requests are made before the first event. Later events are triggered in chronological order.

The simulator never displays real evacuation permission or sends notifications, calls, location changes or navigation. Its runtime context is transient in memory; stopping clears the exercise. Reloading the simulation route provides a safe exit message rather than silently opening a real Live session.

**Backend limits:** tsunami and power-outage milestones remain historical context only, not Safety Core-supported hazard decisions. The supported AI path is synthetic earthquake Mock Live.

## Validation

- Android ASUS_AI2201_A Chrome: navigated from disaster-test to simulation; countdown 01:00:00 to 00:04:00 with no API requests. First Mock Live request only after about 6.5 seconds; the real Safety Core produced NOW text. Home/Plan/Timeline/Settings worked, no horizontal overflow at 411px.
- Unit test: 5 seconds at 600x did not call Mock Live; the first API call occurred at the earthquake boundary. No real Live session persisted and no dialing links appeared.
- Final regression, build and cloud Preview sign-off recorded separately.

Branch codex/p1-8-immersive-simulation. Keep Production on P1.2.
