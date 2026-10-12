import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from media_diff import registry


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_DIFF_STATE_DIR", str(tmp_path))
    yield


@pytest.fixture
def health_server():
    """A tiny HTTP server answering ``/api/health`` like media-diff."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path == registry.HEALTH_PATH:
                body = json.dumps({"service": "media-diff", "status": "ok"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *args):  # silence test output
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield port
    finally:
        server.shutdown()
        server.server_close()


def test_state_dir_override(tmp_path):
    assert registry.state_dir() == tmp_path


def test_register_load_unregister():
    entry = registry.register("127.0.0.1", 8123, "0.1.0")
    assert entry["pid"] == os.getpid()

    loaded = registry.load_instances()
    assert len(loaded) == 1
    assert loaded[0]["port"] == 8123

    registry.unregister(os.getpid(), 8123)
    assert registry.load_instances() == []


def test_register_is_idempotent_for_same_pid_port():
    registry.register("127.0.0.1", 8123, "0.1.0")
    registry.register("127.0.0.1", 8123, "0.1.0")
    assert len(registry.load_instances()) == 1


def test_prune_drops_dead_pid():
    registry.register("127.0.0.1", 8123, "0.1.0")
    instances = registry.load_instances()
    instances.append(
        {
            "pid": 2**31 - 1,
            "host": "127.0.0.1",
            "port": 9999,
            "url": "http://127.0.0.1:9999",
            "version": "0.1.0",
            "started_at": "2020-01-01T00:00:00",
        }
    )
    path = registry.registry_path()
    path.write_text(json.dumps(instances), encoding="utf-8")

    alive = registry.prune()
    ports = {item["port"] for item in alive}
    assert ports == {8123}


def test_status_reports_running_flag():
    registry.register("127.0.0.1", 8123, "0.1.0")
    status = registry.status_instances()
    assert len(status) == 1
    assert status[0]["running"] is False


def test_register_records_start_token():
    entry = registry.register("127.0.0.1", 8123, "0.1.0")
    assert "start_token" in entry
    # On Linux the token is readable from /proc; on other platforms it may be
    # None, which still means "cannot verify" (kept alive conservatively).
    if registry.process_start_token(os.getpid()) is not None:
        assert entry["start_token"] == registry.process_start_token(os.getpid())


def test_prune_drops_reused_pid():
    if registry.process_start_token(os.getpid()) is None:
        pytest.skip("process start token not available on this platform")
    registry.register("127.0.0.1", 8123, "0.1.0")
    instances = registry.load_instances()
    # os.getpid() is alive, but the recorded token belongs to a different
    # (gone) process -> the entry must be treated as stale.
    instances[0]["start_token"] = "not-this-process"
    registry.registry_path().write_text(json.dumps(instances), encoding="utf-8")
    assert registry.prune() == []


def test_stop_instance_reused_pid_is_not_running():
    if registry.process_start_token(os.getpid()) is None:
        pytest.skip("process start token not available on this platform")
    registry.register("127.0.0.1", 8123, "0.1.0")
    registry.unregister(os.getpid(), 8123)  # start from a clean registry
    registry.registry_path().write_text(
        json.dumps(
            [
                {
                    "pid": os.getpid(),
                    "host": "127.0.0.1",
                    "port": 8123,
                    "url": "http://127.0.0.1:8123",
                    "start_token": "not-this-process",
                }
            ]
        ),
        encoding="utf-8",
    )
    entry = registry.load_instances()[0]
    assert registry.stop_instance(entry, force=False) == "not_running"
    assert registry.load_instances() == []


def test_is_process_alive_current_process():
    assert registry.is_process_alive(os.getpid()) is True
    assert registry.is_process_alive(2**31 - 1) is False


def test_url_for_wildcard_host():
    assert registry.url_for("0.0.0.0", 8000) == "http://127.0.0.1:8000"
    assert registry.url_for("127.0.0.1", 8000) == "http://127.0.0.1:8000"


def test_health_check_ok(health_server):
    payload = registry.health_check("127.0.0.1", health_server)
    assert payload is not None
    assert payload["service"] == "media-diff"


def test_health_check_ignores_proxy_env(health_server, monkeypatch):
    # A configured proxy must not be used for the localhost probe, otherwise a
    # live server looks unreachable.
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:1")
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
    payload = registry.health_check("127.0.0.1", health_server)
    assert payload is not None


def test_health_check_falls_back_to_loopback(health_server):
    # Bind host is not locally routable; loopback fallback should still find it.
    payload = registry.health_check("10.255.255.1", health_server, timeout=0.3)
    assert payload is not None


def test_stop_instance_not_running():
    entry = {"pid": 2**31 - 1, "host": "127.0.0.1", "port": 65000}
    assert registry.stop_instance(entry, force=True) == "not_running"


def test_stop_instance_force_terminates():
    import subprocess
    import sys

    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"]
    )
    try:
        entry = {
            "pid": proc.pid,
            "host": "127.0.0.1",
            "port": 65001,
            "url": "http://127.0.0.1:65001",
        }
        assert registry.stop_instance(entry, timeout=5.0, force=True) == "stopped"
        assert registry.is_process_alive(proc.pid) is False
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def test_stop_instance_unverified_without_force():
    import subprocess
    import sys

    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"]
    )
    try:
        entry = {
            "pid": proc.pid,
            "host": "127.0.0.1",
            "port": 65002,
            "url": "http://127.0.0.1:65002",
        }
        assert registry.stop_instance(entry, force=False) == "unverified"
        assert registry.is_process_alive(proc.pid) is True
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()

