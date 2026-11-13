import os

import pytest
from PIL import Image

from media_diff import config
from media_diff.utils.security import (
    AccessDeniedError,
    ensure_within_access_root,
    get_access_root,
    get_access_roots,
    is_within_access_root,
    validate_access_root,
)


def test_unrestricted_by_default(monkeypatch):
    monkeypatch.setattr(config, "ACCESS_ROOT", None)
    assert get_access_root() is None
    assert is_within_access_root("/etc/passwd") is True
    assert ensure_within_access_root("/etc/passwd") == "/etc/passwd"


def test_within_root(tmp_path, monkeypatch):
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setattr(config, "ACCESS_ROOT", str(root))
    real_root = os.path.realpath(str(root))

    assert get_access_root() == real_root
    assert is_within_access_root(str(root)) is True
    assert is_within_access_root(str(root / "sub")) is True
    assert is_within_access_root(str(tmp_path)) is False
    assert is_within_access_root("/etc") is False

    with pytest.raises(AccessDeniedError):
        ensure_within_access_root("/etc")


def test_traversal_and_symlink_escape_blocked(tmp_path, monkeypatch):
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setattr(config, "ACCESS_ROOT", str(root))

    # ".." traversal out of the root is rejected after normalization.
    assert is_within_access_root(str(root / ".." / "escape")) is False

    # A symlink inside the root pointing outside is rejected (realpath).
    outside = tmp_path / "secret"
    outside.mkdir()
    link = root / "link"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not supported")
    assert is_within_access_root(str(link)) is False


def test_api_enforces_access_root(client, tmp_path, monkeypatch):
    root = tmp_path / "data"
    (root / "sub").mkdir(parents=True)
    (root / "clip.txt").write_text("inside")
    real_root = os.path.realpath(str(root))
    monkeypatch.setattr(config, "ACCESS_ROOT", str(root))

    assert client.get("/api/filesystem/roots").json()["roots"] == [real_root]
    assert client.get("/api/filesystem/home").json()["path"] == real_root

    # Inside the root is allowed.
    assert (
        client.post("/api/filesystem/browse", json={"path": str(root)}).status_code
        == 200
    )
    assert (
        client.post(
            "/api/filesystem/browse", json={"path": str(root / "sub")}
        ).status_code
        == 200
    )

    # Outside the root is rejected with 403 (existence is not leaked).
    assert (
        client.post(
            "/api/filesystem/browse", json={"path": str(tmp_path)}
        ).status_code
        == 403
    )
    assert (
        client.post("/api/filesystem/browse", json={"path": "/etc"}).status_code
        == 403
    )
    assert (
        client.post("/api/filesystem/videos", json={"path": "/etc"}).status_code == 403
    )

    # Image access outside the root is rejected.
    outside_img = tmp_path / "outside.png"
    Image.new("RGB", (4, 4)).save(outside_img)
    assert (
        client.get(
            "/api/images/view", params={"path": str(outside_img)}
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/api/images/thumbnail", params={"path": str(outside_img)}
        ).status_code
        == 403
    )

    # Video info outside the root is rejected.
    assert (
        client.get(
            "/api/videos/info", params={"path": str(tmp_path / "x.mp4")}
        ).status_code
        == 403
    )

    # Blind-eval output outside the root is rejected.
    assert (
        client.post(
            "/api/blind-eval/load", json={"output_path": "/etc/x.json"}
        ).status_code
        == 403
    )


def test_caches_do_not_bypass_access_root(client, tmp_path, monkeypatch):
    """Entries cached before a root was configured must not be served outside it.

    Simulates the "populate caches unrestricted, then restart with --root" case:
    every path is validated before any cache is consulted.
    """
    from media_diff.utils.cache import thumbnail_cache
    from media_diff.utils.video_cache import video_info_cache

    root = tmp_path / "allowed"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    img = outside / "a.png"
    Image.new("RGB", (4, 4)).save(img)
    vid = outside / "v.mp4"
    vid.write_bytes(b"x")

    # Caches populated while the server was unrestricted.
    thumbnail_cache.put(str(img), 200, b"jpeg-bytes", "hist", img.stat().st_mtime)
    video_info_cache.put(
        str(vid), {"codec": "h264", "browser_playable": True}, vid.stat().st_mtime
    )

    monkeypatch.setattr(config, "ACCESS_ROOT", str(root))

    assert (
        client.get("/api/images/thumbnail", params={"path": str(img)}).status_code
        == 403
    )
    assert client.get("/api/images/view", params={"path": str(img)}).status_code == 403
    assert client.get("/api/videos/info", params={"path": str(vid)}).status_code == 403
    assert (
        client.get("/api/videos/stream", params={"path": str(vid)}).status_code == 403
    )
    assert (
        client.get("/api/videos/frame", params={"path": str(vid), "frame": 1}).status_code
        == 403
    )


def test_multiple_roots_allow_each(tmp_path, monkeypatch):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    (a / "sub").mkdir()
    (b / "sub").mkdir()
    real_a = os.path.realpath(str(a))
    real_b = os.path.realpath(str(b))
    monkeypatch.setattr(config, "ACCESS_ROOTS", [str(a), str(b)])
    monkeypatch.setattr(config, "ACCESS_ROOT", None)

    assert get_access_roots() == [real_a, real_b]
    assert get_access_root() == real_a  # back-compat: first root
    for path in (a, a / "sub", b, b / "sub"):
        assert is_within_access_root(str(path)) is True
    outside = tmp_path / "outside"
    outside.mkdir()
    assert is_within_access_root(str(outside)) is False
    assert is_within_access_root("/etc/passwd") is False
    with pytest.raises(AccessDeniedError):
        ensure_within_access_root(str(outside))


def test_multiple_roots_normalized_and_deduped(tmp_path, monkeypatch):
    a = tmp_path / "a"
    a.mkdir()
    monkeypatch.setattr(
        config, "ACCESS_ROOTS", [str(a), str(a), str(a / "."), ""]
    )
    monkeypatch.setattr(config, "ACCESS_ROOT", None)
    assert get_access_roots() == [os.path.realpath(str(a))]


def test_validate_access_root_checks_all_roots(tmp_path, monkeypatch):
    ok = tmp_path / "ok"
    ok.mkdir()
    missing = tmp_path / "missing"
    monkeypatch.setattr(config, "ACCESS_ROOTS", [str(ok), str(missing)])
    monkeypatch.setattr(config, "ACCESS_ROOT", None)
    with pytest.raises(RuntimeError, match="missing"):
        validate_access_root()


def test_legacy_access_root_still_works(tmp_path, monkeypatch):
    """Older callers/tests only set ACCESS_ROOT; it must still be honored."""
    root = tmp_path / "legacy"
    root.mkdir()
    monkeypatch.setattr(config, "ACCESS_ROOTS", [])
    monkeypatch.setattr(config, "ACCESS_ROOT", str(root))
    assert get_access_roots() == [os.path.realpath(str(root))]
    assert is_within_access_root(str(root / "x")) is True
