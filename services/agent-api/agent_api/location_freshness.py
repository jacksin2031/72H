"""Freshness rules shared by location ingestion and movement authorization."""

from __future__ import annotations

from datetime import datetime, timedelta

MAX_GPS_LOCATION_AGE = timedelta(minutes=2)


def gps_observation_is_fresh(observed_at: datetime | None, now: datetime) -> bool:
    """Check the bounded freshness window for an explicitly GPS-sourced location."""
    return (
        observed_at is not None
        and observed_at <= now
        and now - observed_at <= MAX_GPS_LOCATION_AGE
    )
