import argparse

from media_diff import cli
from media_diff.cli import _select_targets


def make_args(**kwargs) -> argparse.Namespace:
    base = {"all": False, "pid": None, "port": None}
    base.update(kwargs)
    return argparse.Namespace(**base)


def test_select_single_instance_by_default():
    instances = [{"pid": 1, "port": 8000}]
    assert _select_targets(instances, make_args()) == instances


def test_select_ambiguous_returns_none():
    instances = [{"pid": 1, "port": 8000}, {"pid": 2, "port": 9000}]
    assert _select_targets(instances, make_args()) is None


def test_select_all():
    instances = [{"pid": 1, "port": 8000}, {"pid": 2, "port": 9000}]
    assert _select_targets(instances, make_args(all=True)) == instances


def test_select_by_port():
    instances = [{"pid": 1, "port": 8000}, {"pid": 2, "port": 9000}]
    assert _select_targets(instances, make_args(port=9000)) == [
        {"pid": 2, "port": 9000}
    ]


def test_select_by_pid():
    instances = [{"pid": 1, "port": 8000}, {"pid": 2, "port": 9000}]
    assert _select_targets(instances, make_args(pid=1)) == [
        {"pid": 1, "port": 8000}
    ]


def test_select_no_match_returns_empty():
    instances = [{"pid": 1, "port": 8000}]
    assert _select_targets(instances, make_args(port=1234)) == []


def test_open_browser_prints_hint_on_failure(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_try_open", lambda url: False)
    cli._open_browser("http://127.0.0.1:8000")
    assert "http://127.0.0.1:8000" in capsys.readouterr().out


def test_open_browser_silent_on_success(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_try_open", lambda url: True)
    cli._open_browser("http://127.0.0.1:8000")
    assert capsys.readouterr().out == ""
