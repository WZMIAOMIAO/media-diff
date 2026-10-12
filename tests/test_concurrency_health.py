"""End-to-end check that /api/health stays responsive under sync-pool load.

The liveness probe is what ``media-diff status`` / ``stop`` rely on. It used to
be a synchronous endpoint sharing FastAPI's AnyIO worker threadpool, so a burst
of slow synchronous requests (image thumbnails etc.) could starve it and make a
perfectly healthy server look "unreachable". This test saturates that pool for
real and asserts health still answers quickly.
"""

import json
import socket
import threading
import time
import urllib.request

import pytest
import uvicorn

from media_diff import config
from media_diff.app import create_app


def _free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def _wait_ready(base: str, timeout: float = 10.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(base + "/api/health", timeout=0.5).read()
            return
        except Exception:
            time.sleep(0.05)
    raise RuntimeError("server did not become ready")


@pytest.fixture
def live_server(monkeypatch, tmp_path):
    # Small sync pool so a handful of blocking requests fully saturate it.
    monkeypatch.setattr(config, "SYNC_THREAD_LIMIT", 2)

    # Make a genuinely synchronous endpoint block, holding a pool thread. Patch
    # the name the router module imported (it calls ``list_images`` directly).
    from media_diff.routers import filesystem as fs_router

    def slow_list_images(path, recursive=False):
        time.sleep(0.4)
        return []

    monkeypatch.setattr(fs_router, "list_images", slow_list_images)

    app = create_app()
    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(
            app, host="127.0.0.1", port=port, log_level="warning", access_log=False
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    _wait_ready(base)
    try:
        yield base, str(tmp_path)
    finally:
        server.should_exit = True
        thread.join(timeout=5)


def _post_sync_block(base: str, path: str) -> None:
    req = urllib.request.Request(
        base + "/api/filesystem/images",
        data=json.dumps({"path": path}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10).read()
    except Exception:
        pass


def test_health_reports_live_pool_size(live_server):
    base, _ = live_server
    with urllib.request.urlopen(base + "/api/health", timeout=2) as resp:
        body = json.loads(resp.read())
    # Lifespan applied the configured value to the real AnyIO limiter.
    assert body["concurrency"]["threads"] == 2


def test_health_responds_while_sync_pool_is_saturated(live_server):
    base, path = live_server

    workers = [
        threading.Thread(target=_post_sync_block, args=(base, path)) for _ in range(6)
    ]
    for worker in workers:
        worker.start()
    # Let them grab every pool thread (2) and start blocking.
    time.sleep(0.15)

    start = time.perf_counter()
    with urllib.request.urlopen(base + "/api/health", timeout=2) as resp:
        body = json.loads(resp.read())
    elapsed = time.perf_counter() - start

    assert body["service"] == "media-diff"
    # Health is async and must not queue behind the saturated sync pool.
    assert elapsed < 0.3, f"health took {elapsed:.3f}s under load"

    for worker in workers:
        worker.join(timeout=10)
