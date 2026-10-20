"""Tests for background zip job cleanup (temp-file lifecycle)."""

import os
import tempfile
import time
import uuid

from media_diff.utils import zip_jobs


def _make_temp_zip(age_seconds: float) -> str:
    name = f"media_diff_zip_test{uuid.uuid4().hex}.zip"
    path = os.path.join(tempfile.gettempdir(), name)
    with open(path, "wb") as fh:
        fh.write(b"x")
    mtime = time.time() - age_seconds
    os.utime(path, (mtime, mtime))
    return path


def test_orphan_cleanup_removes_only_old_unreferenced():
    old = _make_temp_zip(age_seconds=zip_jobs._JOB_TTL + 60)
    fresh = _make_temp_zip(age_seconds=5)
    try:
        with zip_jobs._jobs_lock:
            zip_jobs._cleanup_orphans_locked(time.time())
        assert not os.path.exists(old)  # stale orphan removed
        assert os.path.exists(fresh)  # recent file kept
    finally:
        for p in (old, fresh):
            if os.path.exists(p):
                os.unlink(p)


def test_orphan_cleanup_keeps_referenced_file():
    path = _make_temp_zip(age_seconds=zip_jobs._JOB_TTL + 60)
    jid = uuid.uuid4().hex
    try:
        with zip_jobs._jobs_lock:
            zip_jobs._jobs[jid] = {
                "id": jid,
                "path": "/x",
                "zip_path": path,
                "state": "running",
                "created_at": time.time(),
                "finished_at": None,
            }
            zip_jobs._cleanup_orphans_locked(time.time())
        # An old file still referenced by a live job is never deleted.
        assert os.path.exists(path)
    finally:
        with zip_jobs._jobs_lock:
            zip_jobs._jobs.pop(jid, None)
        if os.path.exists(path):
            os.unlink(path)


def _register_done_job(path: str) -> str:
    jid = uuid.uuid4().hex
    now = time.time()
    with zip_jobs._jobs_lock:
        zip_jobs._jobs[jid] = {
            "id": jid,
            "path": "/x",
            "filename": "x.zip",
            "total": 1,
            "done": 1,
            "progress": 1.0,
            "state": "done",
            "error": None,
            "zip_path": path,
            "created_at": now,
            "finished_at": now,
            "cancel": False,
            "timer": None,
        }
    return jid


def test_schedule_release_deletes_after_grace(monkeypatch):
    monkeypatch.setattr(zip_jobs, "_RELEASE_GRACE", 0.2)
    path = _make_temp_zip(age_seconds=0)
    jid = _register_done_job(path)
    zip_jobs.schedule_release(jid)
    time.sleep(0.6)
    assert zip_jobs.zip_status(jid) is None
    assert not os.path.exists(path)


def test_take_zip_file_cancels_pending_release(monkeypatch):
    monkeypatch.setattr(zip_jobs, "_RELEASE_GRACE", 0.2)
    path = _make_temp_zip(age_seconds=0)
    jid = _register_done_job(path)
    try:
        zip_jobs.schedule_release(jid)
        # A new request (browser resume) cancels the pending deletion.
        assert zip_jobs.take_zip_file(jid) is not None
        time.sleep(0.6)
        assert zip_jobs.zip_status(jid) is not None
        assert os.path.exists(path)
    finally:
        with zip_jobs._jobs_lock:
            zip_jobs._remove_locked(jid)


def _register_running_job(interested: int) -> str:
    jid = uuid.uuid4().hex
    now = time.time()
    with zip_jobs._jobs_lock:
        zip_jobs._jobs[jid] = {
            "id": jid,
            "path": "/x",
            "filename": "x.zip",
            "total": 1,
            "done": 0,
            "progress": 0.0,
            "state": "running",
            "error": None,
            "zip_path": None,
            "created_at": now,
            "finished_at": None,
            "cancel": False,
            "timer": None,
            "interested": interested,
            "dir_mtime": None,
        }
    return jid


def test_cancel_shared_job_only_aborts_when_all_clients_cancel():
    jid = _register_running_job(interested=2)
    try:
        # First client cancels: the shared compression keeps going.
        assert zip_jobs.cancel_zip_job(jid) is True
        assert zip_jobs.zip_status(jid)["state"] == "running"
        with zip_jobs._jobs_lock:
            assert zip_jobs._jobs[jid]["cancel"] is False
        # Last client cancels: the job is flagged for abort.
        assert zip_jobs.cancel_zip_job(jid) is True
        with zip_jobs._jobs_lock:
            assert zip_jobs._jobs[jid]["cancel"] is True
    finally:
        with zip_jobs._jobs_lock:
            zip_jobs._remove_locked(jid)

