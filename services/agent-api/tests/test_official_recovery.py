"""Durable recovery tests: actual XML adapters, checkpoints and Safety Core."""
from datetime import timedelta
from dataclasses import replace
from hashlib import sha256
import sqlite3

import pytest

from agent_api.live import LiveStore
from agent_api.live_sources import HttpPayload, JmaEarthquakeSource, JmaTsunamiSource
from agent_api.official_journal import SQLiteOfficialJournal, MemoryOfficialJournal, GCSOfficialJournal, JournalConflict
from agent_api.official_recovery import SHORT_FEED, LONG_FEED, JournalFrame
from seventytwoh_contracts.models import LiveSourceStatus
from test_official_events import quake
from test_live_sources import NOW, DETAIL_URL, TSUNAMI_DETAIL_URL, _tsunami_detail
from test_live_tsunami import _DestinationSource, _profile


class Harness:
    def __init__(self, product="VXSE53", count=1):
        self.product = product
        self.wall = NOW + timedelta(seconds=30)
        self.mono = 0.0
        self.calls = []
        self.documents = {}
        for i in range(count):
            url = (DETAIL_URL if product == "VXSE53" else TSUNAMI_DETAIL_URL).replace("010000", f"{i:06d}")
            body = (quake(seconds=i, event_id=f"2026100601{i:04d}") if product == "VXSE53"
                    else _tsunami_detail(report_at=(NOW + timedelta(seconds=i)).isoformat()).replace(
                        b"20261006010000", f"2026100601{i:04d}".encode()))
            self.documents[url] = body
        self.short = self.feed(tuple(self.documents))
        self.long = self.short
        self.conditional = False
        self.failure = None

    def feed(self, urls, *, oldest=NOW):
        title = "震源・震度に関する情報" if self.product == "VXSE53" else "津波警報・注意報・予報"
        entries = ''.join(f'<entry><id>{url}</id><title>{title}</title><updated>{oldest.isoformat()}</updated>'
            f'<link type="application/xml" href="{url}"/></entry>' for url in urls)
        return f'<feed xmlns="http://www.w3.org/2005/Atom"><updated>{self.wall.isoformat()}</updated>{entries}</feed>'.encode()

    def fetch(self, url, headers):
        self.calls.append((url, headers))
        if self.failure:
            raise OSError(self.failure)
        if url in {SHORT_FEED, LONG_FEED}:
            if self.conditional and "If-None-Match" in headers:
                return HttpPayload(304, b"", {})
            return HttpPayload(200, self.short if url == SHORT_FEED else self.long, {"etag": '"snapshot-1"'})
        return HttpPayload(200, self.documents[url], {})

    def source(self, journal, *, detail_limit=5):
        cls = JmaEarthquakeSource if self.product == "VXSE53" else JmaTsunamiSource
        return cls(self.fetch, now=lambda: self.wall, clock=lambda: self.mono, journal=journal, detail_limit=detail_limit)

    def step(self, seconds=61):
        self.wall += timedelta(seconds=seconds)
        self.mono += seconds


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
def test_more_than_five_details_resume_across_polls_and_304_without_false_completion(tmp_path, product):
    harness = Harness(product, 12)
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    source = harness.source(journal)
    first = source.fetch_latest()
    assert first.status == LiveSourceStatus.INVALID_RESPONSE
    assert first.recovery.pending_details == 7
    assert first.recovery.last_verified_at is None
    assert len([url for url, _ in harness.calls if url not in {SHORT_FEED, LONG_FEED}]) == 5
    harness.conditional = True
    harness.step()
    second = source.fetch_latest()
    assert second.recovery.pending_details == 2
    assert second.recovery.last_verified_at is None
    harness.step()
    completed = source.fetch_latest()
    assert completed.status == LiveSourceStatus.FRESH
    assert completed.recovery.scan_status == "WINDOW_VERIFIED"
    assert completed.recovery.archived_reports == 12
    assert completed.recovery.last_verified_at == NOW + timedelta(seconds=30)
    assert len([url for url, _ in harness.calls if url == LONG_FEED]) == 1
    assert all(item.bulletin.received_at <= harness.wall for item in (completed.reports if product == "VXSE53" else completed.bulletins))
    read = journal.load(product)
    assert JournalFrame.model_validate_json(read.document).pending == ()


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
def test_restart_restores_pending_scan_without_losing_saved_records(tmp_path, product):
    harness = Harness(product, 9)
    path = tmp_path / "journal.sqlite3"
    first = harness.source(SQLiteOfficialJournal(path)).fetch_latest()
    assert first.recovery.archived_reports == 5
    harness.step()
    source = harness.source(SQLiteOfficialJournal(path))
    recovered = source.fetch_latest()
    assert recovered.recovery.restored
    assert recovered.recovery.archived_reports == 9
    # Startup rechecks the long snapshot, so already checked entries may be
    # queued once more; this does not duplicate records or refresh publication.
    while recovered.recovery.pending_details:
        harness.step()
        recovered = source.fetch_latest()
    assert recovered.status == LiveSourceStatus.FRESH
    metadata = JournalFrame.model_validate_json(SQLiteOfficialJournal(path).load(product).document).reports
    assert len({item.raw_sha256 for item in metadata}) == 9
    assert metadata[0].received_at == NOW + timedelta(seconds=30)


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
def test_cancellation_tombstone_survives_restart_expiry_and_delayed_old_issue(tmp_path, product):
    harness = Harness(product)
    old_url = next(iter(harness.documents))
    cancel_url = old_url.replace("000000", "000001")
    harness.documents[cancel_url] = (quake(seconds=5, info="取消") if product == "VXSE53" else
        _tsunami_detail(info_type="取消", origin="", report_at=(NOW + timedelta(seconds=5)).isoformat()))
    harness.long = harness.short = harness.feed((cancel_url, old_url))
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    first = harness.source(journal).fetch_latest()
    head = first.reports[-1] if product == "VXSE53" else first.bulletins[-1]
    assert head.bulletin.operation.value == "CANCEL"
    assert head.occurred_at is not None
    harness.step(901)
    harness.short = harness.long = harness.feed((old_url,))
    restored = harness.source(SQLiteOfficialJournal(journal.path)).fetch_latest()
    head = restored.reports[-1] if product == "VXSE53" else restored.bulletins[-1]
    assert head.bulletin.operation.value == "CANCEL"
    assert head.bulletin.issued_at == NOW + timedelta(seconds=5)
    assert restored.status == LiveSourceStatus.STALE
    assert restored.last_published_at == NOW + timedelta(seconds=5)
    if product == "VTSE41":
        assert all(item.status.value == "UNKNOWN" for item in restored.forecast_areas)


@pytest.mark.parametrize("empty", [False, True])
def test_missing_feed_window_preserves_events_and_never_advances_verified_checkpoint(tmp_path, empty):
    harness = Harness()
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    source = harness.source(journal)
    first = source.fetch_latest()
    harness.step(8 * 86400)
    url = next(iter(harness.documents))
    harness.documents[url] = quake(seconds=8 * 86400 - 1)
    harness.long = harness.short = harness.feed(() if empty else (url,), oldest=harness.wall - timedelta(seconds=1))
    after = harness.source(SQLiteOfficialJournal(journal.path)).fetch_latest()
    assert after.status == LiveSourceStatus.INVALID_RESPONSE
    assert after.recovery.scan_status == "GAP"
    assert after.recovery.last_verified_at == first.recovery.last_verified_at
    assert after.reports  # An empty feed cannot clear the old official unit.
    assert after.recovery.last_checked_at == harness.wall


def test_malformed_batch_never_partially_commits_or_advances_queue(tmp_path):
    harness = Harness(count=6)
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    source = harness.source(journal, detail_limit=2)
    first = source.fetch_latest()
    before = journal.load("VXSE53")
    bad_url = tuple(harness.documents)[3]
    harness.documents[bad_url] = b"<broken>"
    harness.step()
    failed = source.fetch_latest()
    assert failed.status == LiveSourceStatus.BACKOFF
    assert journal.load("VXSE53") == before
    assert failed.recovery.archived_reports == first.recovery.archived_reports == 2
    assert failed.recovery.pending_details == 4
    assert failed.recovery.storage_status == "HEALTHY"


def test_storage_failure_retains_only_committed_data_and_redacts_exception(tmp_path):
    harness = Harness(count=8)
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    source = harness.source(journal)
    first = source.fetch_latest()
    before = journal.load("VXSE53")
    def fail(*args):
        raise OSError("credential-must-not-appear")
    journal.commit = fail
    harness.step()
    failed = source.fetch_latest()
    assert failed.recovery.storage_status == "FAILED"
    assert failed.recovery.archived_reports == first.recovery.archived_reports
    assert journal.load("VXSE53") == before
    assert "credential" not in failed.recovery.model_dump_json()
    assert "credential" not in failed.detail


@pytest.mark.parametrize("corruption", ["checkpoint", "missing_raw", "wrong_bytes", "future_clock"])
def test_corrupt_restore_is_unknown_and_never_published_as_current(tmp_path, corruption):
    harness = Harness()
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    harness.source(journal).fetch_latest()
    read = journal.load("VXSE53")
    frame = JournalFrame.model_validate_json(read.document)
    with sqlite3.connect(journal.path) as connection:
        if corruption == "checkpoint":
            connection.execute("UPDATE checkpoints SET document=?", (b"{}",))
        elif corruption == "future_clock":
            changed = frame.model_copy(update={"last_verified_at": harness.wall + timedelta(days=1)})
            connection.execute("UPDATE checkpoints SET document=?", (changed.model_dump_json().encode(),))
        elif corruption == "missing_raw":
            connection.execute("DELETE FROM raw_objects WHERE digest=?", (frame.reports[0].raw_sha256,))
        else:
            connection.execute("UPDATE raw_objects SET content=? WHERE digest=?", (b"changed", frame.reports[0].raw_sha256))
    harness.step()
    result = harness.source(SQLiteOfficialJournal(journal.path)).fetch_latest()
    assert result.status == LiveSourceStatus.BACKOFF
    assert result.recovery.scan_status == "UNKNOWN"
    assert result.recovery.storage_status == "FAILED"
    assert result.reports == ()
    assert result.recovery.last_verified_at is None


def test_sqlite_compare_and_swap_prevents_a_stale_writer_overwriting_a_checkpoint(tmp_path):
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    raw = b"original"
    digest = sha256(raw).hexdigest()
    first = journal.commit("VXSE53", 0, b"one", {digest: raw})
    with pytest.raises(JournalConflict):
        SQLiteOfficialJournal(journal.path).commit("VXSE53", 0, b"lost update", {})
    assert journal.load("VXSE53").document == b"one"
    assert journal.read_raw(digest) == raw
    assert first == 1


def test_partial_recovery_invalidates_actual_live_guidance_until_scan_is_verified(tmp_path):
    harness = Harness(count=1)
    source = harness.source(SQLiteOfficialJournal(tmp_path / "journal.sqlite3"))
    store = LiveStore(jma_source=source, destination_source=_DestinationSource(), now=lambda: harness.wall)
    first = store.start({"language": "zh-TW", "profile": _profile()})
    assert first.evidence
    additions = Harness(count=12)
    harness.documents = additions.documents
    harness.short = harness.long = additions.short
    harness.step(3601)
    incomplete = store.refresh(first.session_id)
    assert incomplete.source.recovery.pending_details > 0
    assert incomplete.source.status == LiveSourceStatus.INVALID_RESPONSE
    assert not any(item.eligible_for_claims for item in incomplete.evidence_projections)
    assert incomplete.spatial_guidance.movement_authorized is False
    assert first.plans[0].id in {item.id for item in incomplete.plans}


def test_network_health_is_independent_of_durable_storage_health(tmp_path):
    harness = Harness()
    source = harness.source(SQLiteOfficialJournal(tmp_path / "journal.sqlite3"))
    first = source.fetch_latest()
    harness.failure = "offline"
    harness.step()
    offline = source.fetch_latest()
    assert offline.status == LiveSourceStatus.BACKOFF
    assert offline.recovery.storage_status == "HEALTHY"
    assert offline.recovery.last_verified_at == first.recovery.last_verified_at
    assert offline.retrieved_at == first.retrieved_at
    assert offline.recovery.connection_status == "UNAVAILABLE"


class FakeGCS:
    """Models GCS generation preconditions; not live cloud integration evidence."""
    def __init__(self):
        self.objects = {}
        self.sequence = 0

    def bucket(self, name):
        return self

    def list_blobs(self, *, prefix, **kwargs):
        from types import SimpleNamespace
        return [SimpleNamespace(name=name, size=len(value[0])) for name, value in self.objects.items() if name.startswith(prefix)]

    def blob(self, name):
        owner = self
        class Blob:
            generation = None
            size = 0

            def reload(self, **kwargs):
                from google.api_core.exceptions import NotFound
                if name not in owner.objects:
                    raise NotFound("missing")
                data, token = owner.objects[name]
                self.generation, self.size = token, len(data)

            def upload_from_string(self, raw, *, if_generation_match, **kwargs):
                from google.api_core.exceptions import PreconditionFailed
                token = owner.objects.get(name, (None, 0))[1]
                if if_generation_match != token:
                    raise PreconditionFailed("changed")
                owner.sequence += 1
                owner.objects[name] = (raw, owner.sequence)
                self.generation, self.size = owner.sequence, len(raw)

            def download_as_bytes(self, *, if_generation_match, **kwargs):
                from google.api_core.exceptions import PreconditionFailed
                data, token = owner.objects[name]
                if token != if_generation_match:
                    raise PreconditionFailed("changed")
                return data
        return Blob()


def test_gcs_immutable_bytes_precede_checkpoint_cas_and_conflict_preserves_winner():
    client = FakeGCS()
    journal = GCSOfficialJournal("test-bucket", client=client)
    assert journal.load("VXSE53").token == 0
    raw = b"official bytes"
    digest = sha256(raw).hexdigest()
    first = journal.commit("VXSE53", 0, b"one", {digest: raw})
    assert journal.read_raw(digest) == raw
    assert journal.load("VXSE53").document == b"one"
    with pytest.raises(JournalConflict):
        journal.commit("VXSE53", 0, b"lost update", {digest: raw})
    assert journal.load("VXSE53").token == first
    second = journal.commit("VXSE53", first, b"two", {digest: raw})
    assert second > first
    assert journal.load("VXSE53").document == b"two"


def test_two_source_writers_reload_the_winning_checkpoint_before_retry(tmp_path):
    harness = Harness(count=6)
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    a = harness.source(journal, detail_limit=2)
    a.fetch_latest()
    b = harness.source(SQLiteOfficialJournal(journal.path), detail_limit=2)
    b._recovery_engine._load()
    harness.step()
    a.fetch_latest()
    winner = journal.load("VXSE53")
    conflict = b.fetch_latest()
    assert conflict.status == LiveSourceStatus.BACKOFF
    assert journal.load("VXSE53") == winner
    assert b._recovery_engine.loaded is False
    harness.step()
    retry = b.fetch_latest()
    assert retry.recovery.archived_reports >= 4
    assert retry.recovery.checkpoint_version > winner.token


def test_obsolete_feed_bytes_are_pruned_but_historical_reports_remain(tmp_path):
    harness = Harness()
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    source = harness.source(journal)
    source.fetch_latest()
    old = JournalFrame.model_validate_json(journal.load("VXSE53").document)
    old_feed = old.feeds[0].raw_sha256
    harness.step(3601)
    url = next(iter(harness.documents))
    harness.documents[url] = quake(seconds=3600, intensity="5+")
    harness.long = harness.short = harness.feed((url,), oldest=NOW)
    source.fetch_latest()
    after = JournalFrame.model_validate_json(journal.load("VXSE53").document)
    assert len(after.reports) == 2  # Unchanged Atom entry cannot hide a different detail body.
    # Long forced recheck read the new XML even with unchanged entry identity.
    assert source._recovery_engine.states[next(iter(source._recovery_engine.states))].head.issued_at == NOW + timedelta(seconds=3600)
    assert journal.read_raw(old.reports[0].raw_sha256)
    with pytest.raises(ValueError, match="missing bytes"):
        journal.read_raw(old_feed)


def test_more_than_256_revisions_remain_durable_after_in_memory_history_compaction(tmp_path):
    harness = Harness(count=0)
    for i in range(257):
        url = DETAIL_URL.replace("010000", f"{i:06d}")
        harness.documents[url] = quake(seconds=i, serial="1")
    harness.long = harness.short = harness.feed(tuple(harness.documents))
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    source = harness.source(journal)
    result = source.fetch_latest()
    while result.recovery.pending_details:
        harness.step()
        result = source.fetch_latest()
    assert result.recovery.archived_reports == 257
    assert result.reports[0].bulletin.issued_at == NOW + timedelta(seconds=256)
    harness.step()
    recovered = harness.source(SQLiteOfficialJournal(journal.path)).fetch_latest()
    assert recovered.recovery.archived_reports == 257
    assert recovered.reports[0].bulletin.issued_at == NOW + timedelta(seconds=256)


def test_empty_cold_feed_does_not_assert_a_verified_window(tmp_path):
    harness = Harness(count=0)
    source = harness.source(SQLiteOfficialJournal(tmp_path / "journal.sqlite3"))
    result = source.fetch_latest()
    assert result.recovery.last_verified_at is None
    assert result.recovery.scan_status == "NOT_STARTED"
    assert result.status == LiveSourceStatus.UNSUPPORTED


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
def test_polling_gap_waits_for_new_long_snapshot_and_304_never_advances_proof(tmp_path, product):
    harness = Harness(product)
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    source = harness.source(journal)
    first = source.fetch_latest()
    harness.step(1200)
    url = next(iter(harness.documents))
    harness.documents[url] = quake(seconds=1200) if product == "VXSE53" else _tsunami_detail(report_at=harness.wall.isoformat())
    harness.short = harness.feed((url,), oldest=harness.wall)
    interrupted = source.fetch_latest()
    assert interrupted.status == LiveSourceStatus.INVALID_RESPONSE
    assert interrupted.recovery.scan_status == "SCANNING"
    assert interrupted.recovery.pending_details == 0
    assert interrupted.recovery.last_verified_at == first.recovery.last_verified_at
    assert interrupted.recovery.reconciliation_required_since == harness.wall
    harness.conditional = True
    harness.step()
    unchanged = source.fetch_latest()
    assert unchanged.recovery.scan_status == "SCANNING"
    assert unchanged.recovery.last_verified_at == first.recovery.last_verified_at
    # The interruption survives a process restart, even when HTTP is reachable.
    source = harness.source(SQLiteOfficialJournal(journal.path))
    harness.step()
    assert source.fetch_latest().recovery.scan_status == "SCANNING"
    harness.conditional = False
    harness.long = harness.short = harness.feed((url,), oldest=NOW)
    harness.step()
    recovered = source.fetch_latest()
    assert recovered.recovery.scan_status == "WINDOW_VERIFIED"
    assert recovered.recovery.reconciliation_required_since is None
    assert recovered.recovery.last_verified_at < recovered.retrieved_at


def test_hourly_polling_does_not_requeue_already_processed_details(tmp_path):
    harness = Harness(count=6)
    source = harness.source(SQLiteOfficialJournal(tmp_path / "journal.sqlite3"))
    source._poll_interval = 3600
    first = source.fetch_latest()
    assert first.recovery.pending_details == 1
    harness.step(3600)
    harness.long = harness.short = harness.feed(tuple(harness.documents))
    second = source.fetch_latest()
    assert second.recovery.pending_details == 0
    assert second.recovery.archived_reports == 6
    assert second.recovery.scan_status == "WINDOW_VERIFIED"


def test_short_only_poll_and_304_retain_long_publication_proof(tmp_path):
    harness = Harness()
    source = harness.source(SQLiteOfficialJournal(tmp_path / "journal.sqlite3"))
    first = source.fetch_latest()
    harness.conditional = True
    harness.step()
    second = source.fetch_latest()
    assert second.recovery.last_verified_at == first.recovery.last_verified_at
    assert second.retrieved_at > first.retrieved_at


def test_gcs_budget_is_shared_bounded_and_includes_failed_cas_orphans(monkeypatch):
    import agent_api.official_journal as module
    monkeypatch.setattr(module, "MAX_LOCAL_ARCHIVE_BYTES", 12)
    client = FakeGCS()
    journal = GCSOfficialJournal("test-bucket", client=client)
    raw = b"one"
    digest = sha256(raw).hexdigest()
    journal.commit("VXSE53", 0, b"first", {digest: raw})
    orphan = b"orphan"
    with pytest.raises(JournalConflict):
        journal.commit("VXSE53", 0, b"loser", {sha256(orphan).hexdigest(): orphan})
    before = journal.load("VXSE53")
    raw = b"over"
    with pytest.raises(ValueError, match="capacity"):
        journal.commit("VTSE41", 0, b"second", {sha256(raw).hexdigest(): raw})
    assert journal.load("VXSE53") == before
    assert journal.load("VTSE41").token == 0
    assert f"{journal.prefix}/raw/{sha256(raw).hexdigest()}.xml" not in client.objects


def test_live_references_are_bound_to_session_outcomes_and_expire_without_new_receipts(tmp_path):
    from seventytwoh_contracts.models import LiveSnapshot
    eq, ts = Harness(), Harness("VTSE41")
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    store = LiveStore(jma_source=eq.source(journal), tsunami_source=ts.source(journal),
                      destination_source=_DestinationSource(), now=lambda: eq.wall)
    snapshot = store.start({"language": "zh-TW", "profile": _profile()})
    assert {item.product for item in snapshot.official_reports} == {"VXSE53", "VTSE41"}
    assert len(snapshot.official_sources) == 2
    assert all(not item.eligible_for_action for item in snapshot.official_reports)
    assert LiveSnapshot.model_validate_json(snapshot.model_dump_json(round_trip=True)) == snapshot
    # A shared source refresh must not change another session's retained outcome.
    ts.step(61)
    url = next(iter(ts.documents))
    ts.documents[url] = _tsunami_detail(info_type="取消", report_at=ts.wall.isoformat())
    ts.short = ts.feed((url,), oldest=ts.wall)
    reference = store.get_tsunami_reference()
    assert reference.official_reports[0].lifecycle == "WITHDRAWN"
    unchanged = store.get(snapshot.session_id)
    assert unchanged.official_reports == snapshot.official_reports
    eq.step(901)
    stale = store.get(snapshot.session_id)
    assert all(item.lifecycle == "STALE" for item in stale.official_reports)
    assert [item.received_at for item in stale.official_reports] == [item.received_at for item in snapshot.official_reports]
    assert [item.id for item in snapshot.plans] == [item.id for item in stale.plans][:len(snapshot.plans)]


def test_recovery_retries_after_bounded_backoff_instead_of_waiting_normal_poll(tmp_path):
    harness = Harness()
    source = harness.source(SQLiteOfficialJournal(tmp_path / "journal.sqlite3"))
    source.fetch_latest()
    harness.step()
    harness.failure = "offline"
    failed = source.fetch_latest()
    count = len(harness.calls)
    harness.step(4)
    source.fetch_latest()
    assert len(harness.calls) == count
    harness.failure = None
    harness.step(1)
    recovered = source.fetch_latest()
    assert len(harness.calls) > count
    assert recovered.status == LiveSourceStatus.FRESH
    assert recovered.recovery.last_verified_at == failed.recovery.last_verified_at


def test_incomplete_tsunami_scan_blocks_verified_session_even_without_active_tsunami(tmp_path):
    from seventytwoh_contracts.models import LiveSnapshot, NetworkState
    from pydantic import ValidationError
    eq, ts = Harness(), Harness("VTSE41", count=6)
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    store = LiveStore(jma_source=eq.source(journal), tsunami_source=ts.source(journal),
                      destination_source=_DestinationSource(), now=lambda: eq.wall)
    first = store.start({"language": "zh-TW", "profile": _profile()})
    assert first.source.status == LiveSourceStatus.FRESH
    assert first.official_sources[1].recovery.scan_status == "SCANNING"
    assert not any(item.event_type.value == "TSUNAMI" for item in first.events)
    assert first.situation.network_state == NetworkState.ONLINE_DEGRADED
    aggregate = store._get_aggregate(first.session_id)
    assert aggregate.state.official_recovery_ready is False
    forged = first.model_dump(round_trip=True)
    forged["situation"]["network_state"] = "ONLINE_VERIFIED"
    with pytest.raises(ValidationError, match="incomplete official recovery"):
        LiveSnapshot.model_validate(forged)
    eq.step()
    ts.step()
    completed = store.refresh(first.session_id)
    assert completed.official_sources[1].recovery.scan_status == "WINDOW_VERIFIED"
    assert aggregate.state.official_recovery_ready is True
    assert completed.situation.network_state == NetworkState.ONLINE_VERIFIED
    assert completed.spatial_guidance.movement_authorized is False


def test_official_distant_earthquake_without_japan_observations_does_not_poison_recovery(tmp_path):
    from pathlib import Path
    from agent_api.live_sources import _parse_jma_detail
    harness = Harness()
    url = "https://www.data.jma.go.jp/developer/xml/data/20261009185024_0_VXSE53_010000.xml"
    raw = (Path(__file__).parent / "fixtures/jma_lifecycle/live-unobserved-VXSE53.xml").read_bytes()
    assert sha256(raw).hexdigest() == "8a4a096f97dcd78ce80b88d0ea4d61d3f6c7dc0c7ecab9fda2f5b11939161c9c"
    # Use its actual official clocks, never rewrite an official test fixture.
    from datetime import datetime, timezone
    harness.wall = datetime(2026, 10, 12, 0, 0, tzinfo=timezone.utc)
    harness.documents = {url: raw}
    harness.long = harness.short = harness.feed((url,))
    source = harness.source(SQLiteOfficialJournal(tmp_path / "journal.sqlite3"))
    store = LiveStore(jma_source=source, destination_source=_DestinationSource(), now=lambda: harness.wall)
    snapshot = store.start({"language": "zh-TW", "profile": _profile()})
    assert snapshot.source.recovery.scan_status == "WINDOW_VERIFIED"
    assert snapshot.official_reports[0].target_codes == ()
    assert snapshot.official_reports[0].lifecycle == "STALE"
    assert snapshot.events == () and snapshot.evidence == ()
    assert snapshot.spatial_guidance.movement_authorized is False
    # An ordinary malformed report cannot claim this narrow exception.
    with pytest.raises(ValueError, match="observed intensity"):
        _parse_jma_detail(url, raw.replace('遠地地震に関する情報'.encode(), '震源・震度に関する情報'.encode()), harness.wall)


def test_reconnect_barrier_waits_for_tsunami_backlog_despite_fresh_earthquake_proof(tmp_path):
    from test_live_tsunami import _begin_reconnect
    from seventytwoh_contracts.models import NetworkState
    eq, ts = Harness(), Harness("VTSE41", count=0)
    ts.long = ts.short = ts.feed(()).replace(b"</feed>",
        f'<entry><title>火山情報</title><updated>{NOW.isoformat()}</updated></entry></feed>'.encode())
    journal = SQLiteOfficialJournal(tmp_path / "journal.sqlite3")
    store = LiveStore(jma_source=eq.source(journal), tsunami_source=ts.source(journal),
                      destination_source=_DestinationSource(), now=lambda: eq.wall)
    first = store.start({"language": "zh-TW", "profile": _profile()})
    assert not any(item.event_type.value == "TSUNAMI" for item in first.events)
    _begin_reconnect(store, first, NOW + timedelta(seconds=60))
    eq.step(1200)
    ts.step(1200)
    url = next(iter(eq.documents))
    eq.documents[url] = quake(seconds=1230, serial="2")
    eq.long = eq.short = eq.feed((url,), oldest=NOW)
    additions = Harness("VTSE41", count=6)
    ts.documents = {url: _tsunami_detail(report_at=ts.wall.isoformat()).replace(
        b"20261006010000", f"2026100601{i:04d}".encode()) for i, url in enumerate(additions.documents)}
    ts.long = ts.short = ts.feed(tuple(ts.documents), oldest=NOW)
    pending = store.refresh(first.session_id)
    assert pending.official_sources[0].recovery.scan_status == "WINDOW_VERIFIED"
    assert pending.official_sources[1].recovery.pending_details == 1
    assert pending.situation.network_state == NetworkState.RECONNECTING
    assert not any(item.event_type == "RECONCILIATION_COMPLETED" for item in pending.trace)
    eq.step()
    ts.step()
    complete = store.refresh(first.session_id)
    assert complete.situation.network_state == NetworkState.ONLINE_VERIFIED
    assert all(item.recovery.scan_status == "WINDOW_VERIFIED" for item in complete.official_sources)
    assert any(item.event_type == "RECONCILIATION_COMPLETED" for item in complete.trace)
    assert complete.spatial_guidance.movement_authorized is False


def test_pinned_official_tsunami_forecast_validity_is_preserved_without_extending_ttl(tmp_path):
    from pathlib import Path
    from datetime import datetime, timezone
    from agent_api.live_sources import _parse_jma_tsunami_detail, jma_report_deadline
    from agent_api.official_events import reduce_official_bulletin, BulletinValidity
    url = "https://www.data.jma.go.jp/developer/xml/data/20261009183743_0_VTSE41_010000.xml"
    raw = (Path(__file__).parent / "fixtures/jma_lifecycle/live-validity-VTSE41.xml").read_bytes()
    assert sha256(raw).hexdigest() == "e088e061cdf7abf68821df26c2ed709775cdbf493905b53d5e7135bfc4483196"
    now = datetime(2026, 10, 12, tzinfo=timezone.utc)
    bulletin = _parse_jma_tsunami_detail(url, raw, now)
    assert bulletin.bulletin.valid_until == datetime(2026, 10, 11, 11, tzinfo=timezone.utc)
    assert jma_report_deadline(bulletin) == bulletin.published_at + timedelta(seconds=900)
    assert reduce_official_bulletin(None, bulletin.bulletin).validity(now, 900) == BulletinValidity.STALE
    harness = Harness("VTSE41")
    harness.wall = now
    harness.documents = {url: raw}
    harness.long = harness.short = harness.feed((url,))
    result = harness.source(SQLiteOfficialJournal(tmp_path / "journal.sqlite3")).fetch_latest()
    assert result.recovery.scan_status == "WINDOW_VERIFIED"
    assert result.status == LiveSourceStatus.STALE
    assert result.references[0].official_valid_until == bulletin.bulletin.valid_until
    assert all(area.status.value == "UNKNOWN" for area in result.forecast_areas)


@pytest.mark.parametrize("journalled", [False, True])
def test_forecast_deadline_shortens_ttl_and_never_lifts_hazard_on_expiry(tmp_path, journalled):
    harness = Harness("VTSE41")
    url = next(iter(harness.documents))
    valid = NOW + timedelta(seconds=120)
    harness.documents[url] = _tsunami_detail(kind="71").replace(b"</Head>",
        f"<ValidDateTime>{valid.isoformat()}</ValidDateTime></Head>".encode())
    source = harness.source(SQLiteOfficialJournal(tmp_path / "journal.sqlite3")) if journalled else JmaTsunamiSource(
        harness.fetch, now=lambda: harness.wall, clock=lambda: harness.mono)
    store = LiveStore(jma_source=Harness().source(MemoryOfficialJournal()), tsunami_source=source,
        destination_source=_DestinationSource(), now=lambda: harness.wall)
    first = store.start({"language": "zh-TW", "profile": _profile()})
    assert first.events and first.evidence
    from agent_api.live_sources import JMA_TSUNAMI_SOURCE_KEY
    tsunami_proof = next(item for item in first.evidence if item.source_key == JMA_TSUNAMI_SOURCE_KEY)
    assert tsunami_proof.expires_at == valid
    harness.step(90)  # Exact official deadline, still within the 15-minute TTL.
    saved = store.get(first.session_id)  # No source fetch is needed to expire the public snapshot.
    assert saved.official_sources[1].status == LiveSourceStatus.STALE
    saved_proof = next(item for item in saved.evidence if item.source_key == JMA_TSUNAMI_SOURCE_KEY)
    assert saved_proof.freshness_status.value == "STALE" and not saved_proof.eligible_for_high_risk
    assert all(item.status.value == "UNKNOWN" for item in saved.events if item.event_type.value == "TSUNAMI")
    assert saved.spatial_guidance.movement_authorized is False
    stale = source.fetch_latest(force=True)
    assert stale.status == LiveSourceStatus.STALE
    assert all(item.status.value == "UNKNOWN" for item in stale.forecast_areas)
    if journalled:
        assert stale.references[0].lifecycle == "STALE"
        assert stale.references[0].evidence_expires_at == valid
        saved = store.get(first.session_id)
        assert saved.official_sources[1].status == LiveSourceStatus.STALE
    updated = store.refresh(first.session_id)
    assert not any(item.event_type.value == "TSUNAMI" and item.status.value == "RESOLVED" for item in updated.events)
    assert updated.spatial_guidance.movement_authorized is False


def test_warning_cannot_use_forecast_validity_exception():
    from agent_api.live_sources import _parse_jma_tsunami_detail
    raw = _tsunami_detail(kind="53").replace(b"</Head>",
        f"<ValidDateTime>{(NOW + timedelta(seconds=120)).isoformat()}</ValidDateTime></Head>".encode())
    with pytest.raises(ValueError, match="slight sea-level-change"):
        _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, raw, NOW + timedelta(seconds=30))
