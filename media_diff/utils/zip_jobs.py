"""Background folder-zip jobs with progress.

Packing a folder can take a while, so the frontend first asks the server to
prepare a zip, polls its progress (so the UI can show "compressing … " instead
of an opaque wait), then downloads the finished file with a normal browser
download.

State lives server-side keyed by an opaque job id; jobs expire after a TTL and
their temp files are removed on download or expiry.
"""

import atexit
import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from media_diff.utils.filesystem import create_zip_archive

# A zip job is CPU + IO bound; a couple in parallel is plenty, and it keeps a
# burst of requests from spawning unbounded threads.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="zip")

_jobs: dict[str, dict] = {}
# path key -> current job id, so concurrent requests for the same folder share
# one compression (and one finished file).
_by_path: dict[str, str] = {}
_jobs_lock = threading.Lock()

# Finished jobs (and their temp files) are removed this long after they finish,
# as a safety net for jobs that are never downloaded (aborted/abandoned).
_JOB_TTL = 1800.0

# After a download response is sent the file is kept for this long so a browser
# that pauses and later resumes the download (issuing more Range requests) still
# finds it. Each new request pushes the deadline back; an idle finished job is
# removed once it lapses.
_RELEASE_GRACE = 300.0
_SWEEP_INTERVAL = 300.0

_sweeper_started = False
_sweeper_lock = threading.Lock()


class ZipCancelled(Exception):
    """Raised inside a job to abort an archive the client cancelled."""


def _discard_file(path: str | None) -> None:
    if path and os.path.exists(path):
        try:
            os.unlink(path)
        except OSError:
            pass


def _path_key(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))


def _dir_mtime(path: str) -> float | None:
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def _prune_locked(now: float) -> None:
    """Drop finished jobs (and their files) older than the TTL.

    Age is measured from when the job *finished*, not when it started, so a slow
    compression cannot cause a just-finished file to be pruned before the client
    downloads it.
    """
    for jid, job in list(_jobs.items()):
        if job["state"] in ("pending", "running"):
            continue
        finished_at = job.get("finished_at") or job["created_at"]
        if now - finished_at > _JOB_TTL:
            _remove_locked(jid)


def _cleanup_orphans_locked(now: float) -> None:
    """Delete temp zips that no live job references (e.g. left by a crash).

    Only files older than the TTL are removed, and any path still referenced by
    a job is skipped, so an in-progress archive is never deleted.
    """
    live = {
        job["zip_path"] for job in _jobs.values() if job.get("zip_path")
    }
    tmpdir = tempfile.gettempdir()
    try:
        names = os.listdir(tmpdir)
    except OSError:
        return
    for name in names:
        if not (name.startswith("media_diff_zip_") and name.endswith(".zip")):
            continue
        full = os.path.join(tmpdir, name)
        if full in live:
            continue
        try:
            if now - os.path.getmtime(full) > _JOB_TTL:
                os.unlink(full)
        except OSError:
            pass


def _sweep_loop() -> None:
    while True:
        time.sleep(_SWEEP_INTERVAL)
        now = time.time()
        with _jobs_lock:
            _prune_locked(now)
            _cleanup_orphans_locked(now)


def _ensure_sweeper() -> None:
    """Start the periodic cleanup thread once."""
    global _sweeper_started
    if _sweeper_started:
        return
    with _sweeper_lock:
        if _sweeper_started:
            return
        _sweeper_started = True
        threading.Thread(
            target=_sweep_loop, name="zip-sweeper", daemon=True
        ).start()


def _cancel_timer_locked(job: dict) -> None:
    timer = job.get("timer")
    if timer is not None:
        timer.cancel()
        job["timer"] = None


def _remove_locked(jid: str) -> None:
    job = _jobs.pop(jid, None)
    if job is None:
        return
    _cancel_timer_locked(job)
    _discard_file(job.get("zip_path"))
    key = _path_key(job["path"])
    if _by_path.get(key) == jid:
        _by_path.pop(key, None)


def start_zip_job(path: str, filename: str, total: int) -> str:
    """Start or join a background zip job for ``path``; returns its job id.

    Concurrent requests for the same folder (same path, unchanged) share one
    job: while it is pending/running they see the same progress, and once it is
    done they download the same file (each download restarts the release grace
    timer). A path whose directory changed since the job started gets a fresh
    job. Finished jobs are only reused while their file still exists.
    """
    _ensure_sweeper()
    key = _path_key(path)
    mtime = _dir_mtime(path)
    with _jobs_lock:
        now = time.time()
        _prune_locked(now)

        existing = _by_path.get(key)
        if existing is not None:
            job = _jobs.get(existing)
            if job is not None and job.get("dir_mtime") == mtime:
                if job["state"] in ("pending", "running"):
                    job["interested"] = job.get("interested", 1) + 1
                    return existing
                if (
                    job["state"] == "done"
                    and job.get("zip_path")
                    and os.path.exists(job["zip_path"])
                ):
                    return existing

        jid = uuid.uuid4().hex
        _jobs[jid] = {
            "id": jid,
            "path": path,
            "filename": filename,
            "total": max(total, 0),
            "done": 0,
            "progress": 0.0,
            "state": "pending",
            "error": None,
            "zip_path": None,
            "created_at": now,
            "finished_at": None,
            "cancel": False,
            "timer": None,
            "interested": 1,
            "dir_mtime": mtime,
        }
        _by_path[key] = jid
    _executor.submit(_run_job, jid)
    return jid


def zip_status(job_id: str) -> dict | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        return {
            "state": job["state"],
            "progress": round(float(job["progress"]), 4),
            "total": job["total"],
            "done": job["done"],
            "filename": job["filename"],
            "error": job.get("error"),
        }


def cancel_zip_job(job_id: str) -> bool:
    """Cancel a packing job.

    Because concurrent requests may share one job, a cancel only aborts the
    compression once every interested client has cancelled; a single cancel just
    drops that client. Cancelling a finished job removes its file immediately.
    """
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return False
        if job["state"] in ("pending", "running"):
            job["interested"] = max(0, job.get("interested", 1) - 1)
            if job["interested"] == 0:
                job["cancel"] = True
        else:
            _remove_locked(job_id)
    return True


def take_zip_file(job_id: str) -> tuple[str, str] | None:
    """Return ``(zip_path, filename)`` for a finished job (else ``None``).

    Any pending post-download deletion is cancelled so an in-flight transfer (or
    a browser resume) is never cut short; the caller reschedules deletion via
    :func:`schedule_release` once the response has been sent.
    """
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job["state"] != "done" or not job.get("zip_path"):
            return None
        _cancel_timer_locked(job)
        return job["zip_path"], job["filename"]


def schedule_release(job_id: str) -> None:
    """Schedule deletion of a finished job's temp file after a grace period.

    Used as the ``FileResponse`` background task: once a download response has
    been sent the file is kept for ``_RELEASE_GRACE`` seconds so a browser that
    paused the download can resume it with further Range requests. Every new
    request restarts the countdown (via :func:`take_zip_file` + this function),
    and a job that stays idle past the grace period is removed.
    """
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job["state"] != "done":
            return
        _cancel_timer_locked(job)
        timer = threading.Timer(_RELEASE_GRACE, release_zip_job, args=(job_id,))
        timer.daemon = True
        job["timer"] = timer
        timer.start()


def release_zip_job(job_id: str) -> None:
    """Remove a job and its temp file."""
    with _jobs_lock:
        _remove_locked(job_id)


def _run_job(jid: str) -> None:
    with _jobs_lock:
        job = _jobs.get(jid)
        if job is None:
            return
        job["state"] = "running"
        path = job["path"]
        total = job["total"]

    fd, tmp_path = tempfile.mkstemp(suffix=".zip", prefix="media_diff_zip_")
    os.close(fd)
    with _jobs_lock:
        current = _jobs.get(jid)
        if current is not None:
            # Register the file immediately so the orphan sweeper never deletes
            # an archive that is still being written.
            current["zip_path"] = tmp_path

    def on_entry() -> None:
        with _jobs_lock:
            current = _jobs.get(jid)
            if current is None:
                raise ZipCancelled()
            if current["cancel"]:
                raise ZipCancelled()
            current["done"] += 1
            if total:
                current["progress"] = min(1.0, current["done"] / total)

    try:
        create_zip_archive(path, tmp_path, on_entry=on_entry)
    except ZipCancelled:
        _discard_file(tmp_path)
        with _jobs_lock:
            _remove_locked(jid)
        return
    except Exception as exc:  # surfaced to the client via zip_status
        _discard_file(tmp_path)
        with _jobs_lock:
            current = _jobs.get(jid)
            if current is not None:
                current["state"] = "error"
                current["error"] = str(exc)
                current["finished_at"] = time.time()
                current["zip_path"] = None
        return

    with _jobs_lock:
        current = _jobs.get(jid)
        if current is None or current["cancel"]:
            _discard_file(tmp_path)
            if current is None:
                return
            _remove_locked(jid)
            return
        current["zip_path"] = tmp_path
        current["state"] = "done"
        current["progress"] = 1.0
        current["finished_at"] = time.time()


def shutdown() -> None:
    """Best-effort shutdown of the zip executor (called on process exit)."""
    _executor.shutdown(wait=False)


# Remove temp files orphaned by a previous run and start the periodic sweeper so
# abandoned archives do not accumulate even with no further download requests.
with _jobs_lock:
    _cleanup_orphans_locked(time.time())
_ensure_sweeper()

atexit.register(shutdown)
