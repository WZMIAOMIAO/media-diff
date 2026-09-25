import json
import os

import pytest

from media_diff import registry


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_DIFF_STATE_DIR", str(tmp_path))
    yield


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


def test_is_process_alive_current_process():
    assert registry.is_process_alive(os.getpid()) is True
    assert registry.is_process_alive(2**31 - 1) is False


def test_url_for_wildcard_host():
    assert registry.url_for("0.0.0.0", 8000) == "http://127.0.0.1:8000"
    assert registry.url_for("127.0.0.1", 8000) == "http://127.0.0.1:8000"


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

