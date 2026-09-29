def test_video_missing_file(client, tmp_path):
    res = client.get(
        "/api/videos/info", params={"path": str(tmp_path / "missing.mp4")}
    )
    assert res.status_code == 404


def test_video_unsupported_extension(client, tmp_path):
    bad = tmp_path / "clip.txt"
    bad.write_text("nope")
    res = client.get("/api/videos/info", params={"path": str(bad)})
    assert res.status_code == 400


def test_videos_listing_ignores_non_video(client, image_dir):
    res = client.post("/api/filesystem/videos", json={"path": str(image_dir)})
    assert res.status_code == 200
    assert res.json()["videos"] == []


def test_clear_transcode_cache(tmp_path, monkeypatch):
    from media_diff.utils import videos

    monkeypatch.setenv("MEDIA_DIFF_TRANSCODE_CACHE_DIR", str(tmp_path))
    (tmp_path / "a.mp4").write_bytes(b"x" * 100)
    (tmp_path / "a.mp4.meta").write_text("{}")
    (tmp_path / "b.mp4").write_bytes(b"y" * 50)

    # dry run reports the cache without deleting anything
    count, total = videos.clear_transcode_cache(dry_run=True)
    assert count == 3
    assert total == 152
    assert len(list(tmp_path.iterdir())) == 3

    removed, freed = videos.clear_transcode_cache()
    assert removed == 3
    assert freed == 152
    assert list(tmp_path.iterdir()) == []

    # clearing an already-empty cache is a no-op
    assert videos.clear_transcode_cache() == (0, 0)


def test_transcode_cache_dir_env_override(tmp_path, monkeypatch):
    from media_diff.utils import videos

    monkeypatch.setenv("MEDIA_DIFF_TRANSCODE_CACHE_DIR", str(tmp_path))
    assert videos.transcode_cache_dir() == str(tmp_path)


def test_transcode_command_forces_mp4_muxer(tmp_path, monkeypatch):
    """The temp output ends in '.tmp', so ffmpeg needs an explicit -f mp4.

    Regression test: without it ffmpeg fails with "Unable to find a suitable
    output format" and transcoding (hence playback) never succeeds.
    """
    import os

    from media_diff.utils import videos

    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    monkeypatch.setenv("MEDIA_DIFF_TRANSCODE_CACHE_DIR", str(tmp_path / "cache"))

    captured: dict = {}

    def fake_run_transcode(cmd, duration, on_progress, timeout=1800.0):
        captured["cmd"] = cmd
        captured["duration"] = duration
        with open(cmd[-1], "wb") as f:  # emulate ffmpeg writing the output
            f.write(b"out")

    monkeypatch.setattr(videos, "get_video_info", lambda p: {"duration": 1.0})
    monkeypatch.setattr(videos, "_run_transcode", fake_run_transcode)
    out = videos.transcode_to_mp4(str(src))

    assert os.path.exists(out)
    cmd = captured["cmd"]
    assert cmd[-1].endswith(".tmp")
    assert "-f" in cmd and cmd[cmd.index("-f") + 1] == "mp4"


def test_browser_playable_codec_whitelist(monkeypatch):
    from media_diff.utils import videos

    cases = [
        ("a.mp4", "h264", True),
        ("a.mp4", "avc1", True),
        ("a.mp4", "mpeg4", False),
        ("a.mp4", "hevc", False),
        ("a.webm", "vp9", True),
        ("a.webm", "av1", True),
        ("a.webm", "theora", False),
        ("a.mp4", "", True),
    ]
    for name, codec, expected in cases:
        monkeypatch.setattr(videos, "get_video_info", lambda p, c=codec: {"codec": c})
        assert videos.is_browser_playable(name) is expected, (name, codec)

    # non-native extension is never directly playable
    assert videos.is_browser_playable("a.mkv") is False


def test_browser_playable_probe_failure_is_optimistic(monkeypatch):
    from media_diff.utils import videos

    def boom(_path):
        raise videos.FFmpegError("probe failed")

    monkeypatch.setattr(videos, "get_video_info", boom)
    assert videos.is_browser_playable("a.mp4") is True


def test_get_playable_path_transcodes_unsupported_codec(tmp_path, monkeypatch):
    from media_diff.utils import videos

    src = tmp_path / "a.mp4"
    src.write_bytes(b"x")
    monkeypatch.setattr(videos.shutil, "which", lambda _bin: "/usr/bin/ffmpeg")
    monkeypatch.setattr(
        videos, "transcode_to_mp4", lambda path: path + ".transcoded.mp4"
    )

    monkeypatch.setattr(videos, "get_video_info", lambda p: {"codec": "mpeg4"})
    assert videos.get_playable_path(str(src)) == str(src) + ".transcoded.mp4"

    monkeypatch.setattr(videos, "get_video_info", lambda p: {"codec": "h264"})
    assert videos.get_playable_path(str(src)) == str(src)


def test_transcode_status_and_async(tmp_path, monkeypatch):
    import threading
    import time

    from media_diff.utils import videos

    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    monkeypatch.setenv("MEDIA_DIFF_TRANSCODE_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(videos, "get_video_info", lambda p: {"duration": 1.0})

    assert videos.transcode_status(str(src))["state"] == "none"

    started = threading.Event()
    release = threading.Event()

    def fake_run_transcode(cmd, duration, on_progress, timeout=1800.0):
        started.set()
        on_progress(0.5)
        release.wait(5)
        with open(cmd[-1], "wb") as f:
            f.write(b"out")

    monkeypatch.setattr(videos, "_run_transcode", fake_run_transcode)
    result = videos.start_transcode_async(str(src))
    assert result["state"] == "pending"
    assert started.wait(5)

    running = videos.transcode_status(str(src))
    assert running["state"] == "running"
    assert 0.0 < running["progress"] < 1.0

    release.set()
    for _ in range(100):
        if videos.transcode_status(str(src))["state"] == "done":
            break
        time.sleep(0.05)
    assert videos.transcode_status(str(src))["state"] == "done"
