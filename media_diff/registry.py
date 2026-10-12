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


def process_start_token(pid: int) -> Optional[str]:
    """A stable per-process identity token (start time), or None if unknown.

    ``is_process_alive`` cannot tell a live media-diff process apart from an
    unrelated process that later reused the same PID. The kernel start time
    (constant for a process's lifetime) lets us detect that reuse: if the token
    recorded at registration no longer matches the running process, the entry
    is stale and must be pruned rather than reported as an unresponsive server.
    """
    if pid <= 0:
        return None
    if sys.platform.startswith("linux"):
        try:
            with open(f"/proc/{pid}/stat", "rb") as handle:
                data = handle.read()
        except OSError:
            return None
        close = data.rfind(b")")
        if close == -1:
            return None
        # After "pid (comm) " the fields start at state; starttime is field 22,
        # i.e. index 19 of the remaining whitespace-separated fields.
        fields = data[close + 2 :].split()
        if len(fields) <= 19:
            return None
        return fields[19].decode("ascii", "ignore")
    try:
        result = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    text = result.stdout.strip()
    return text or None


def _entry_is_alive(entry: dict) -> bool:
    """True if the entry's process is still the same live process.

    Falls back to a plain liveness check when no start token is recorded (e.g.
    entries written by an older version) or it cannot be read.
    """
    pid = int(entry.get("pid") or -1)
    if not is_process_alive(pid):
        return False
    token = entry.get("start_token")
    if not token:
        return True
    current = process_start_token(pid)
    if current is None:
        return True
    return current == token


# Probe with an explicit empty ProxyHandler: a proxy configured in the
# environment (http_proxy/https_proxy) would otherwise route the localhost
# request through it and fail, making a live server look unreachable.
_PROXY_FREE_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _health_probe(url: str, timeout: float) -> Optional[dict]:
    try:
        with _PROXY_FREE_OPENER.open(url, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if isinstance(payload, dict) and payload.get("service") == SERVICE_NAME:
        return payload
    return None


def health_check(host: str, port: int, timeout: float = 1.0) -> Optional[dict]:
    """Return the health payload if a media-diff service answers, else None.

    The registry is local to this machine, so in addition to the recorded bind
    host we also probe loopback. This keeps the check working when the server
    was bound to a specific interface address (or a wildcard) that is not
    directly reachable, avoiding false "unreachable"/"unverified" results.
    """
    candidates: list[str] = [url_for(host, port)]
    for loop in ("127.0.0.1", "::1"):
        candidate = url_for(loop, port)
        if candidate not in candidates:
            candidates.append(candidate)
    for base in candidates:
        payload = _health_probe(base + HEALTH_PATH, timeout)
        if payload is not None:
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
        # Identity token so a later PID reuse is not mistaken for this server.
        "start_token": process_start_token(os.getpid()),
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
    """Drop entries whose process is gone or whose PID was reused, return rest."""
    path = registry_path()
    with _file_lock(state_dir() / LOCK_FILENAME):
        instances = _read(path)
        alive = [item for item in instances if _entry_is_alive(item)]
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

    # A recorded PID that is gone, or was reused by an unrelated process, is a
    # stale entry: clean it up instead of treating it as an unresponsive server.
    if not _entry_is_alive(entry):
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

