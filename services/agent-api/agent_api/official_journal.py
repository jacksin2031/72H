"""Atomic checkpoints and immutable, content-addressed official bytes.

No profile, location, plan or credential is stored here. A checkpoint may move
only after its referenced bytes have been saved. GCS uses ADC and generation
preconditions; an orphan raw object after a failed CAS is harmless.
"""
from __future__ import annotations

import os
import json
import sqlite3
import threading
from dataclasses import dataclass
from contextlib import contextmanager
from functools import lru_cache
from hashlib import sha256
from pathlib import Path

MAX_DOCUMENT_BYTES = 8_000_000
MAX_RAW_BYTES = 2_000_000
MAX_LOCAL_ARCHIVE_BYTES = 64_000_000


class JournalConflict(ValueError):
    """Another writer committed; reload before deriving another checkpoint."""


@dataclass(frozen=True)
class JournalRead:
    document: bytes | None
    token: int


def checked_raw(digest: str, raw: bytes) -> bytes:
    if len(raw) > MAX_RAW_BYTES or sha256(raw).hexdigest() != digest:
        raise ValueError("official archive bytes/hash mismatch")
    return raw


def referenced_raw(documents):
    """Only prune obsolete feed representations; every report remains archived."""
    used = set()
    try:
        for raw in documents:
            document = json.loads(raw)
            if document.get("schema_version") != 1 or "reports" not in document or "feeds" not in document:
                return None  # An opaque/legacy document does not authorize pruning.
            used.update(item["raw_sha256"] for item in (*document["reports"], *document["feeds"]))
    except (ValueError, KeyError, TypeError):
        return None
    return used


class MemoryOfficialJournal:
    kind = "MEMORY"

    def __init__(self):
        self._lock = threading.RLock()
        self._documents = {}
        self._raw = {}

    def load(self, product):
        with self._lock:
            return self._documents.get(product, JournalRead(None, 0))

    def read_raw(self, digest):
        with self._lock:
            return checked_raw(digest, self._raw[digest])

    def commit(self, product, expected, document, raw_objects):
        with self._lock:
            if self.load(product).token != expected:
                raise JournalConflict("official checkpoint changed")
            if len(document) > MAX_DOCUMENT_BYTES:
                raise ValueError("official checkpoint capacity exceeded")
            updated = dict(self._raw)
            updated.update({key: checked_raw(key, value) for key, value in raw_objects.items()})
            documents = {key: value.document for key, value in self._documents.items()}
            documents[product] = document
            used = referenced_raw(documents.values())
            if used is not None:
                updated = {key: value for key, value in updated.items() if key in used}
            if sum(map(len, updated.values())) > MAX_LOCAL_ARCHIVE_BYTES:
                raise ValueError("official raw archive capacity exceeded")
            self._raw = updated
            self._documents[product] = JournalRead(document, expected + 1)
            return expected + 1


class SQLiteOfficialJournal:
    kind = "SQLITE"

    def __init__(self, path: str | Path):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("CREATE TABLE IF NOT EXISTS checkpoints (product TEXT PRIMARY KEY, version INTEGER NOT NULL, document BLOB NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS raw_objects (digest TEXT PRIMARY KEY, content BLOB NOT NULL)")

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=5)
        try:
            connection.execute("PRAGMA synchronous=FULL")
            with connection:
                yield connection
        finally:
            connection.close()

    def load(self, product):
        with self._connect() as connection:
            row = connection.execute("SELECT document, version FROM checkpoints WHERE product=?", (product,)).fetchone()
            if row and len(row[0]) > MAX_DOCUMENT_BYTES:
                raise ValueError("official checkpoint capacity exceeded")
            return JournalRead(bytes(row[0]), row[1]) if row else JournalRead(None, 0)

    def read_raw(self, digest):
        with self._connect() as connection:
            row = connection.execute("SELECT content FROM raw_objects WHERE digest=?", (digest,)).fetchone()
            if row is None:
                raise ValueError("official checkpoint references missing bytes")
            return checked_raw(digest, bytes(row[0]))

    def commit(self, product, expected, document, raw_objects):
        if len(document) > MAX_DOCUMENT_BYTES:
            raise ValueError("official checkpoint capacity exceeded")
        for digest, raw in raw_objects.items():
            checked_raw(digest, raw)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT version FROM checkpoints WHERE product=?", (product,)).fetchone()
            if (row[0] if row else 0) != expected:
                raise JournalConflict("official checkpoint changed")
            for digest, raw in raw_objects.items():
                old = connection.execute("SELECT content FROM raw_objects WHERE digest=?", (digest,)).fetchone()
                if old:
                    checked_raw(digest, bytes(old[0]))
                else:
                    connection.execute("INSERT INTO raw_objects VALUES (?, ?)", (digest, raw))
            # The winning checkpoint and pruning are one transaction. Other
            # products' referenced bytes and all prior report bytes survive.
            documents = dict(connection.execute("SELECT product, document FROM checkpoints").fetchall())
            documents[product] = document
            used = referenced_raw(documents.values())
            if used is not None:
                connection.execute("CREATE TEMP TABLE referenced (digest TEXT PRIMARY KEY)")
                connection.executemany("INSERT INTO referenced VALUES (?)", ((key,) for key in used))
                connection.execute("DELETE FROM raw_objects WHERE digest NOT IN (SELECT digest FROM referenced)")
                connection.execute("DROP TABLE referenced")
            size = connection.execute("SELECT COALESCE(SUM(LENGTH(content)), 0) FROM raw_objects").fetchone()[0]
            if size > MAX_LOCAL_ARCHIVE_BYTES:
                raise ValueError("official raw archive capacity exceeded")
            connection.execute("INSERT INTO checkpoints VALUES (?, ?, ?) ON CONFLICT(product) DO UPDATE SET version=excluded.version, document=excluded.document",
                               (product, expected + 1, document))
            return expected + 1


class GCSOfficialJournal:
    kind = "GCS"

    def __init__(self, bucket: str, prefix="72h-official-v2", *, client=None):
        if not bucket or "/" in bucket or not prefix or ".." in prefix.split("/"):
            raise ValueError("invalid official journal object location")
        self.bucket_name = bucket
        self.prefix = prefix.strip("/")
        self._client = client

    @property
    def bucket(self):
        if self._client is None:
            from google.cloud import storage
            self._client = storage.Client()  # Runtime service identity / ADC only.
        return self._client.bucket(self.bucket_name)

    def _checkpoint(self, product):
        return self.bucket.blob(f"{self.prefix}/{product}/checkpoint.json")

    def load(self, product):
        from google.api_core.exceptions import NotFound
        blob = self._checkpoint(product)
        try:
            blob.reload(timeout=5)
            if blob.size > MAX_DOCUMENT_BYTES:
                raise ValueError("official checkpoint capacity exceeded")
            generation = int(blob.generation)
            raw = blob.download_as_bytes(if_generation_match=generation, timeout=5)
            return JournalRead(raw, generation)
        except NotFound:
            return JournalRead(None, 0)

    def read_raw(self, digest):
        blob = self.bucket.blob(f"{self.prefix}/raw/{digest}.xml")
        blob.reload(timeout=5)
        if blob.size > MAX_RAW_BYTES:
            raise ValueError("official archive capacity exceeded")
        return checked_raw(digest, blob.download_as_bytes(if_generation_match=int(blob.generation), timeout=5))

    def _reserve_bytes(self, raw_objects):
        """CAS a shared, monotonic budget before uploads (including CAS orphans).

        No online deletion: another writer may still reference old bytes. The
        finite namespace fails closed at capacity and requires an operator to
        archive/migrate it. Reservations are never refunded after a failed write.
        """
        from google.api_core.exceptions import NotFound, PreconditionFailed
        blob = self.bucket.blob(f"{self.prefix}/raw-budget.json")
        for _ in range(5):
            try:
                blob.reload(timeout=5)
                if blob.size > MAX_DOCUMENT_BYTES:
                    raise ValueError("official byte budget capacity exceeded")
                expected = int(blob.generation)
                sizes = json.loads(blob.download_as_bytes(if_generation_match=expected, timeout=5))
            except NotFound:
                expected, sizes = 0, {}
                # Account for existing objects before initializing this namespace.
                for item in self.bucket.list_blobs(prefix=f"{self.prefix}/raw/", timeout=5):
                    digest = item.name.rsplit("/", 1)[-1].removesuffix(".xml")
                    sizes[digest] = item.size
                    if len(sizes) > 16384:
                        raise ValueError("official raw object capacity exceeded")
            except PreconditionFailed:
                continue
            if not isinstance(sizes, dict) or any(
                not isinstance(key, str) or len(key) != 64 or any(char not in "0123456789abcdef" for char in key)
                or type(value) is not int or value < 0 or value > MAX_RAW_BYTES for key, value in sizes.items()
            ):
                raise ValueError("invalid official byte budget")
            for digest, raw in raw_objects.items():
                if digest in sizes and sizes[digest] != len(raw):
                    raise ValueError("immutable official byte budget mismatch")
                sizes[digest] = len(raw)
            if len(sizes) > 16384 or sum(sizes.values()) > MAX_LOCAL_ARCHIVE_BYTES:
                raise ValueError("official raw archive capacity exceeded")
            try:
                blob.upload_from_string(json.dumps(sizes, sort_keys=True).encode(), content_type="application/json",
                                        if_generation_match=expected, timeout=5)
                return
            except PreconditionFailed:
                continue
        raise JournalConflict("official byte budget changed repeatedly")

    def commit(self, product, expected, document, raw_objects):
        from google.api_core.exceptions import PreconditionFailed
        if len(document) > MAX_DOCUMENT_BYTES:
            raise ValueError("official checkpoint capacity exceeded")
        for digest, raw in raw_objects.items():
            checked_raw(digest, raw)
        self._reserve_bytes(raw_objects)
        for digest, raw in raw_objects.items():
            blob = self.bucket.blob(f"{self.prefix}/raw/{digest}.xml")
            try:
                blob.upload_from_string(raw, content_type="application/xml", if_generation_match=0, timeout=5)
            except PreconditionFailed:
                if self.read_raw(digest) != raw:
                    raise ValueError("immutable official object mismatch")
        blob = self._checkpoint(product)
        try:
            blob.upload_from_string(document, content_type="application/json", if_generation_match=expected, timeout=5)
        except PreconditionFailed as exc:
            raise JournalConflict("official checkpoint changed") from exc
        return int(blob.generation)


@lru_cache(maxsize=4)
def _configured_journal(bucket, path, cloud):
    if bucket:
        return GCSOfficialJournal(bucket)
    if path:
        return SQLiteOfficialJournal(path)
    if cloud:
        return MemoryOfficialJournal()  # Explicit UNCONFIGURED; never cloud durability.
    return SQLiteOfficialJournal(Path(__file__).resolve().parents[3] / ".work" / "jma-official.sqlite3")


def configured_official_journal():
    return _configured_journal(os.getenv("JMA_JOURNAL_BUCKET", ""), os.getenv("JMA_JOURNAL_PATH", ""), bool(os.getenv("K_SERVICE")))
