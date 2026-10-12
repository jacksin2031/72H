"""Read-only map reports, retaining each official information unit independently."""
from seventytwoh_contracts.models import (
    DisasterMapReferenceResponse, LiveSourceProjection, LiveSourceStatus, OfficialMapReport,
    TsunamiAreaStatus, TsunamiReferenceForecastArea,
)
from .live_sources import JMA_FEED_URL, JMA_SOURCE_KEY, JMA_SOURCE_NAME, JMA_TSUNAMI_SOURCE_KEY, JMA_TSUNAMI_SOURCE_NAME


def project_disaster_map(earthquake, tsunami, now):
    reports, sources = [], []
    for result, key, name, heads in (
        (earthquake, JMA_SOURCE_KEY, JMA_SOURCE_NAME, earthquake.reports),
        (tsunami, JMA_TSUNAMI_SOURCE_KEY, JMA_TSUNAMI_SOURCE_NAME, tsunami.bulletins),
    ):
        references = {item.report_id: item for item in result.references if item.is_head}
        for head in heads:
            if head.bulletin is None or head.bulletin.report_id not in references:
                continue  # Legacy/injected data without original provenance stays unknown.
            bulletin = references[head.bulletin.report_id]
            if bulletin.lifecycle == "CURRENT" and now >= bulletin.evidence_expires_at:
                bulletin = bulletin.model_copy(update={"lifecycle": "STALE"})
            current = bulletin.lifecycle == "CURRENT" and result.status == LiveSourceStatus.FRESH and now < bulletin.evidence_expires_at
            if head.bulletin.product == "VXSE53":
                reports.append(OfficialMapReport(bulletin=bulletin, observations=head.map_observations))
            else:
                reports.append(OfficialMapReport(bulletin=bulletin, forecast_areas=tuple(
                    TsunamiReferenceForecastArea(area_code=area.code, area_name=area.name,
                        status=area.status if current else TsunamiAreaStatus.UNKNOWN, warning_class=area.warning_class,
                        max_height=area.max_height, arrival_at=area.arrival_at) for area in head.forecast_areas)))
        sources.append(LiveSourceProjection(source_key=key, source_name=name, source_url=JMA_FEED_URL,
            status=result.status, retrieved_at=result.retrieved_at, last_published_at=result.last_published_at,
            next_retry_at=result.next_retry_at, record_count=len(heads), detail=result.detail, recovery=result.recovery))
    exceeded = len(reports) > 128 or sum(len(item.observations) for item in reports) > 12000
    if exceeded:
        reports = []
        sources = [source.model_copy(update={"status": LiveSourceStatus.INVALID_RESPONSE,
            "detail": "Map observation capacity exceeded; no partial map is presented as complete."}) for source in sources]
    return DisasterMapReferenceResponse(generated_at=now, sources=tuple(sources), reports=tuple(reports), capacity_exceeded=exceeded)
