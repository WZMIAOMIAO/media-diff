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


def test_cmd_clean_dry_run_then_remove(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("MEDIA_DIFF_TRANSCODE_CACHE_DIR", str(tmp_path))
    (tmp_path / "a.mp4").write_bytes(b"x" * 2048)

    assert cli._cmd_clean(argparse.Namespace(dry_run=True)) == 0
    assert (tmp_path / "a.mp4").exists()
    assert "Run without --dry-run" in capsys.readouterr().out

    assert cli._cmd_clean(argparse.Namespace(dry_run=False)) == 0
    assert not (tmp_path / "a.mp4").exists()
    assert "Removed 1" in capsys.readouterr().out


def test_cmd_clean_empty(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("MEDIA_DIFF_TRANSCODE_CACHE_DIR", str(tmp_path))
    assert cli._cmd_clean(argparse.Namespace(dry_run=False)) == 0
    assert "already empty" in capsys.readouterr().out


def test_apply_concurrency_env(monkeypatch):
    for env in cli._CONCURRENCY_ENV.values():
        monkeypatch.delenv(env, raising=False)
    args = argparse.Namespace(
        extract_concurrency=8,
        transcode_concurrency=2,
        thumbnail_concurrency=3,
        probe_concurrency=5,
    )
    cli._apply_concurrency_env(args)
    assert cli.os.environ["MEDIA_DIFF_EXTRACT_CONCURRENCY"] == "8"
    assert cli.os.environ["MEDIA_DIFF_TRANSCODE_CONCURRENCY"] == "2"
    assert cli.os.environ["MEDIA_DIFF_THUMBNAIL_CONCURRENCY"] == "3"
    assert cli.os.environ["MEDIA_DIFF_PROBE_CONCURRENCY"] == "5"


def test_apply_concurrency_env_ignores_none(monkeypatch):
    for env in cli._CONCURRENCY_ENV.values():
        monkeypatch.setenv(env, "7")
    cli._apply_concurrency_env(
        argparse.Namespace(
            extract_concurrency=None,
            transcode_concurrency=None,
            thumbnail_concurrency=None,
            probe_concurrency=None,
        )
    )
    assert cli.os.environ["MEDIA_DIFF_EXTRACT_CONCURRENCY"] == "7"


def test_apply_root_env_sets_env(tmp_path, monkeypatch):
    monkeypatch.delenv("MEDIA_DIFF_ROOT", raising=False)
    root = tmp_path / "data"
    root.mkdir()
    assert cli._apply_root_env(argparse.Namespace(root=str(root))) is True
    assert cli.os.environ["MEDIA_DIFF_ROOT"] == str(root)


def test_apply_root_env_rejects_missing(tmp_path, capsys):
    assert cli._apply_root_env(argparse.Namespace(root=str(tmp_path / "nope"))) is False
    assert "not an existing directory" in capsys.readouterr().out


def test_apply_root_env_noop_when_absent(monkeypatch):
    monkeypatch.delenv("MEDIA_DIFF_ROOT", raising=False)
    assert cli._apply_root_env(argparse.Namespace(root=None)) is True
    assert "MEDIA_DIFF_ROOT" not in cli.os.environ
