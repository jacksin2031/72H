"""Bounded read/create acceptance probe; outputs no credentials or raw profiles."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--route', action='store_true')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    origin = urlsplit(base)
    if origin.scheme not in {'http', 'https'} or origin.username or origin.password or origin.query or origin.fragment or origin.path:
        parser.error('base-url must be a plain HTTP(S) origin')
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    def call(path: str, body: dict | None = None) -> dict:
        req = Request(base + '/api' + path, method='GET' if body is None else 'POST',
                      data=None if body is None else json.dumps(body).encode(),
                      headers={'Content-Type': 'application/json'})
        with urlopen(req, timeout=55) as response:
            data = response.read(4_000_001)
        assert len(data) <= 4_000_000, 'API response exceeds acceptance bound'
        return json.loads(data)

    profile_location = {'label': 'Tokyo acceptance probe', 'lat': 35.6812, 'lng': 139.7671,
                        'area_ids': ['JP-13', 'JP'], 'observed_at': None}
    live = call('/live/start', {'language': 'zh-TW', 'profile': {
        'current_location': profile_location, 'accommodation_location': profile_location,
        'current_destination': None, 'party_size': 1, 'self_reported_safety_status': 'UNKNOWN',
        'current_plan_summary': '', 'accessibility_constraints': [],
    }})
    assert live['mode'] == 'LIVE' and 'replay' not in live
    assert live['evidence'] and live['events'], 'No real official report reached typed pipeline'
    assert all(not item['is_synthetic'] for item in live['evidence'] + live['events'])
    assert all(item['source_key'] == 'jma-live-eqvol' for item in live['evidence'])
    assert live['evidence_projections'] and live['situation']['claim_states']
    assert any(item['event_type'] == 'OFFICIAL_LIVE_EVIDENCE_ADDED' for item in live['trace'])
    if live['plans']:
        assert live['situation']['current_plan_id'] in {item['id'] for item in live['plans']}
    assert not live['spatial_guidance']['movement_authorized']
    assert not live['spatial_guidance']['map_mount_eligible']
    assert all(item['open_status'] == 'UNKNOWN' for item in live['destinations'])
    assert all(not (item['risk_level'] == 'HIGH' and item['safety_decision'] == 'ALLOW') for item in live['plan_actions'])
    try:
        call('/replay/' + live['session_id'])
    except HTTPError as exc:
        assert exc.code == 404, 'Live session must not resolve in Replay store'
    else:
        raise AssertionError('Live/Replay session stores were not isolated')
    records = {'live-start.json': live}
    route_result = 'NOT RUN'
    if args.route:
        assert live['destinations'], 'No designation available for bounded candidate search'
        routed = call('/live/' + live['session_id'] + '/routes/search', {
            'origin': profile_location, 'destination_id': live['destinations'][0]['id'],
        })
        assert not routed['spatial_guidance']['movement_authorized']
        assert not routed['spatial_guidance']['map_mount_eligible']
        assert routed['routes'], 'Provider route search produced no normalized candidate'
        route = routed['routes'][-1]
        assert route['status'] in {'CANDIDATE', 'UNVERIFIED'}, 'Provider promoted candidate safety'
        if route['geometry']:
            assert route['geometry_kind'] in {'TRANSIT_STATION_SEQUENCE', 'PROVIDER_GEOMETRY'}
            assert len(route['geometry']['coordinates']) >= 2
            route_result = 'CANDIDATE GEOMETRY PASS'
        else:
            route_result = 'CANDIDATE WITHOUT GEOMETRY; MAP NOT VERIFIED'
        records['live-route.json'] = routed
    manifest = {'checked_at': datetime.now(timezone.utc).isoformat(), 'origin': base,
                'official_source_status': live['source']['status'], 'official_evidence': len(live['evidence']),
                'plans': len(live['plans']), 'destinations': len(live['destinations']),
                'movement_authorized': False, 'route_result': route_result, 'files': {}}
    for name, record in records.items():
        data = json.dumps(record, ensure_ascii=False, indent=2).encode('utf-8')
        (output / name).write_bytes(data)
        manifest['files'][name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
