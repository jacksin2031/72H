"""Server-side access to the packaged canonical Japan area registry."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from importlib.resources import files

from pydantic import ValidationError
from seventytwoh_contracts.models import AreaDefinition

BASE_AREA_ID = re.compile(r"^JP-\d{2}$")
SNAPSHOT_AREA_LIMIT = 512


@lru_cache(maxsize=1)
def load_japan_area_registry() -> tuple[AreaDefinition, ...]:
    """Read and validate the full packaged registry once per process."""
    resource = files("seventytwoh_contracts").joinpath("data", "japan-areas.json")
    try:
        payload = json.loads(resource.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError("the canonical Japan area registry is not packaged") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("the canonical Japan area registry could not be read") from exc
    if not isinstance(payload, list):
        raise RuntimeError("the canonical Japan area registry must be a JSON array")
    try:
        registry = tuple(AreaDefinition.model_validate(item) for item in payload)
    except (ValidationError, TypeError) as exc:
        raise RuntimeError("the canonical Japan area registry contains an invalid area") from exc

    by_id = {area.id: area for area in registry}
    if len(by_id) != len(registry):
        raise RuntimeError("the canonical Japan area registry contains duplicate IDs")
    required_base_ids = {"JP", *(f"JP-{number:02d}" for number in range(1, 48))}
    if not required_base_ids.issubset(by_id):
        raise RuntimeError("the canonical Japan area registry is missing country or prefecture areas")
    if by_id["JP"].parent_id is not None:
        raise RuntimeError("the canonical Japan country area must not have a parent")
    if any(by_id[f"JP-{number:02d}"].parent_id != "JP" for number in range(1, 48)):
        raise RuntimeError("canonical prefecture areas must be direct children of Japan")

    for area in registry:
        if area.parent_id is not None and area.parent_id not in by_id:
            raise RuntimeError(f"area {area.id} references an unknown parent")
        visited = {area.id}
        parent_id = area.parent_id
        while parent_id is not None:
            if parent_id in visited:
                raise RuntimeError("the canonical Japan area registry contains an ancestry cycle")
            visited.add(parent_id)
            parent_id = by_id[parent_id].parent_id
    return registry


def base_japan_area_catalog(
    registry: tuple[AreaDefinition, ...] | None = None,
) -> tuple[AreaDefinition, ...]:
    areas = registry if registry is not None else load_japan_area_registry()
    return tuple(area for area in areas if area.id == "JP" or BASE_AREA_ID.fullmatch(area.id))


def catalog_for_state(
    state,
    registry: tuple[AreaDefinition, ...] | None = None,
    *,
    extra_area_ids: tuple[str, ...] = (),
) -> tuple[AreaDefinition, ...]:
    """Build the bounded per-session catalog, retaining ancestry for past references."""
    areas = registry if registry is not None else load_japan_area_registry()
    by_id = {area.id: area for area in areas}
    referenced = {area.id for area in base_japan_area_catalog(areas)}
    referenced.update(area.id for area in state.area_catalog)
    referenced.update(extra_area_ids)

    for location in (
        state.profile.current_location,
        state.profile.accommodation_location,
        state.profile.current_destination,
    ):
        if location is not None:
            referenced.update(location.area_ids)
    for event in state.events:
        referenced.update(event.affected_area_ids)
    for evidence in state.evidence:
        referenced.update(evidence.affected_area_ids)
        referenced.update(item.area_id for item in evidence.disaster_assessments)
    for destination in state.destinations:
        referenced.add(destination.area_id)
    for route in state.routes:
        if route.origin_area_id is not None:
            referenced.add(route.origin_area_id)
    area_ids_by_lower = {area_id.lower(): area_id for area_id in by_id}
    for action in state.plan_actions:
        for dependency in action.dependency_keys:
            for token in dependency.split("."):
                canonical_id = area_ids_by_lower.get(token.lower())
                if canonical_id is not None:
                    referenced.add(canonical_id)

    selected = set(referenced)
    for area_id in tuple(referenced):
        current = by_id.get(area_id)
        if current is None:
            raise ValueError(f"session state references unknown area ID {area_id}")
        while current.parent_id is not None:
            selected.add(current.parent_id)
            current = by_id[current.parent_id]
    if len(selected) > SNAPSHOT_AREA_LIMIT:
        raise ValueError("session area catalog exceeds the 512-area snapshot limit")
    return tuple(area for area in areas if area.id in selected)
