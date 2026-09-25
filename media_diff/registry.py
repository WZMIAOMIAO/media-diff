"""Runtime registry of running media-diff instances.

Each ``media-diff`` process records itself in a small JSON file under the user
state directory so that ``media-diff status`` can list what is running and the
launcher can avoid starting a duplicate on the same host/port.

Liveness is verified in two ways: the recorded PID is still alive, and (for
``status``) the instance answers ``GET /api/health``. Stale entries are pruned
automatically.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional

try:  # POSIX
    import fcntl
except ImportError:  # pragma: no cover - Windows
    fcntl = None  # type: ignore[assignment]

try:  # Windows
    import msvcrt
except ImportError:  # pragma: no cover - POSIX
    msvcrt = None  # type: ignore[assignment]

REGISTRY_FILENAME = "instances.json"
LOCK_FILENAME = "instances.lock"
HEALTH_PATH = "/api/health"
SERVICE_NAME = "media-diff"


def state_dir() -> Path:
    """Directory holding the registry, overridable via ``MEDIA_DIFF_STATE_DIR``."""
    override = os.environ.get("MEDIA_DIFF_STATE_DIR")
    if override:
        return Path(override).expanduser()

    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / SERVICE_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / SERVICE_NAME
    base = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    return Path(base) / SERVICE_NAME


def registry_path() -> Path:
    return state_dir() / REGISTRY_FILENAME


def _probe_host(host: str) -> str:
    """Map wildcard bind addresses to a reachable loopback address."""
    if host in ("0.0.0.0",):
        return "127.0.0.1"
    if host in ("::", "::0"):
        return "::1"
    return host


def url_for(host: str, port: int) -> str:
    display = _probe_host(host)
    if ":" in display:  # IPv6 literal
        display = f"[{display}]"
    return f"http://{display}:{port}"


@contextmanager
def _file_lock(lock_path: Path) -> Iterator[None]:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(lock_path, "a+")
    try:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        elif msvcrt is not None:  # pragma: no cover - Windows
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            except OSError:
                pass
        yield
    finally:
        try:
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            elif msvcrt is not None:  # pragma: no cover - Windows
                handle.seek(0)
                try:
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                except OSError:
                    pass
        finally:
            handle.close()


def _read(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _write(path: Path, instances: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(
        json.dumps(instances, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(tmp, path)


def load_instances() -> list[dict]:
    """Return the raw registry entries (no liveness filtering)."""
    return _read(registry_path())


def is_process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform.startswith("win"):  # pragma: no cover - Windows
        import ctypes

        kernel32 = ctypes.windll.kernel32
        process_query_limited_information = 0x1000
        handle = kernel32.OpenProcess(
            process_query_limited_information, False, pid
        )
        if not handle:
            return False
        exit_code = ctypes.c_ulong()
        ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
        kernel32.CloseHandle(handle)
        return bool(ok) and exit_code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    if sys.platform.startswith("linux") and _is_zombie(pid):
        return False
    return True


def _is_zombie(pid: int) -> bool:
    """True if the Linux process is a zombie (exited but not yet reaped)."""
    try:
        with open(f"/proc/{pid}/stat", "rb") as handle:
            data = handle.read()
    except OSError:
        return False
    close = data.rfind(b")")
    if close == -1 or close + 2 >= len(data):
        return False
    return data[close + 2 : close + 3] == b"Z"


def health_check(host: str, port: int, timeout: float = 1.0) -> Optional[dict]:
    """Return the health payload if a media-diff service answers, else None."""
    url = url_for(host, port) + HEALTH_PATH
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if isinstance(payload, dict) and payload.get("service") == SERVICE_NAME:
        return payload
    return None


def register(host: str, port: int, version: str) -> dict:
    """Record the current process as a running instance."""
    entry = {
        "pid": os.getpid(),
        "host": host,
        "port": port,
        "url": url_for(host, port),
        "version": version,
        "started_at": datetime.now().isoformat(timespec="seconds"),
    }
    path = registry_path()
    with _file_lock(state_dir() / LOCK_FILENAME):
        instances = [
            item
            for item in _read(path)
            if not (item.get("pid") == entry["pid"] and item.get("port") == port)
        ]
        instances.append(entry)
        _write(path, instances)
    return entry


def unregister(pid: int, port: int) -> None:
    path = registry_path()
    with _file_lock(state_dir() / LOCK_FILENAME):
        instances = [
            item
            for item in _read(path)
            if not (item.get("pid") == pid and item.get("port") == port)
        ]
        _write(path, instances)


def prune() -> list[dict]:
    """Drop entries whose process is no longer alive and return the rest."""
    path = registry_path()
    with _file_lock(state_dir() / LOCK_FILENAME):
        instances = _read(path)
        alive = [
            item
            for item in instances
            if is_process_alive(int(item.get("pid", -1)))
        ]
        if len(alive) != len(instances):
            _write(path, alive)
    return alive


def find_on_port(host: str, port: int) -> Optional[dict]:
    """Return an existing live instance on host:port, if any."""
    probe = _probe_host(host)
    for item in prune():
        if item.get("port") != port:
            continue
        if _probe_host(str(item.get("host", ""))) != probe:
            continue
        return item
    if health_check(host, port) is not None:
        return {
            "pid": None,
            "host": host,
            "port": port,
            "url": url_for(host, port),
            "version": None,
            "started_at": None,
        }
    return None


def status_instances() -> list[dict]:
    """Return live entries annotated with a ``running`` health flag."""
    result: list[dict] = []
    for item in prune():
        healthy = health_check(str(item.get("host", "")), int(item.get("port", 0)))
        result.append({**item, "running": healthy is not None})
    return result


def terminate_process(pid: int) -> None:
    """Ask a process to terminate (graceful on POSIX, forced on Windows)."""
    if sys.platform.startswith("win"):  # pragma: no cover - Windows
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/F"],
            capture_output=True,
            check=False,
        )
    else:
        os.kill(pid, signal.SIGTERM)


def stop_instance(
    entry: dict, timeout: float = 5.0, force: bool = False
) -> str:
    """Stop a registered instance.

    Returns one of ``"stopped"``, ``"not_running"``, ``"unverified"`` or
    ``"failed"``. Unless ``force`` is set, the process is only killed after a
    health check confirms it is really a media-diff service (guards against
    PID reuse).
    """
    pid = int(entry.get("pid") or -1)
    port = int(entry.get("port", 0))
    if pid <= 0:
        return "failed"

    if not is_process_alive(pid):
        unregister(pid, port)
        return "not_running"

    if not force:
        health = health_check(str(entry.get("host", "")), port)
        if health is None:
            return "unverified"

    try:
        terminate_process(pid)
    except OSError:
        return "failed"

    deadline = time.time() + timeout
    while time.time() < deadline and is_process_alive(pid):
        time.sleep(0.1)

    if is_process_alive(pid):
        return "failed"

    unregister(pid, port)
    return "stopped"

