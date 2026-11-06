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


def test_transcode_cache_distinct_for_same_name_different_dirs(tmp_path, monkeypatch):
    """Same file name in different folders maps to different cache entries."""
    from media_diff.utils import videos

    monkeypatch.setenv("MEDIA_DIFF_TRANSCODE_CACHE_DIR", str(tmp_path / "cache"))
    a = tmp_path / "a" / "clip.mp4"
    b = tmp_path / "b" / "clip.mp4"
    a.parent.mkdir()
    b.parent.mkdir()
    a.write_bytes(b"x")
    b.write_bytes(b"y")

    assert videos._transcode_key(str(a)) != videos._transcode_key(str(b))
    assert videos._transcode_cache_path(str(a)) != videos._transcode_cache_path(str(b))


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


def test_get_playable_path_cached_uses_only_cache(tmp_path):
    from media_diff.utils import videos
    from media_diff.utils.video_cache import video_info_cache

    src = tmp_path / "clip.mp4"
    src.write_bytes(b"x")
    path = str(src)

    # Nothing probed yet -> cannot decide without running ffmpeg.
    assert videos.get_playable_path_cached(path) is None

    # A cached "playable" decision serves the original file directly (no ffmpeg).
    video_info_cache.put(
        path, {"codec": "h264", "browser_playable": True}, src.stat().st_mtime
    )
    assert videos.get_playable_path_cached(path) == path

    # A cached "not playable" decision with no transcode yet still needs work.
    video_info_cache.put(
        path, {"codec": "mpeg4", "browser_playable": False}, src.stat().st_mtime
    )
    assert videos.get_playable_path_cached(path) is None


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


def test_extract_frame_inflight_dedup(tmp_path, monkeypatch):
    """Concurrent requests for the same frame share a single ffmpeg run."""
    import threading
    import time
    from io import BytesIO

    from PIL import Image

    from media_diff.utils import videos
    from media_diff.utils.video_cache import video_frame_cache

    src = tmp_path / "v.mp4"
    src.write_bytes(b"x")

    buf = BytesIO()
    Image.new("RGB", (2, 2), (10, 20, 30)).save(buf, format="JPEG")
    jpeg = buf.getvalue()

    calls = {"n": 0}
    started = threading.Event()
    release = threading.Event()

    def fake_extract(path, frame_no):
        calls["n"] += 1
        started.set()
        release.wait(5)
        return jpeg

    monkeypatch.setattr(videos, "extract_frame", fake_extract)

    path = str(src)
    frame = 42
    video_frame_cache._cache.pop((path, frame), None)  # noqa: SLF001 - test cleanup

    results = []

    def worker():
        results.append(videos.extract_frame_with_histogram(path, frame))

    t1 = threading.Thread(target=worker)
    t2 = threading.Thread(target=worker)
    t1.start()
    assert started.wait(5)
    t2.start()
    time.sleep(0.3)  # let t2 join the in-flight request
    release.set()
    t1.join(10)
    t2.join(10)

    assert calls["n"] == 1
    assert len(results) == 2
    assert results[0][0] == jpeg and results[1][0] == jpeg


def test_run_reports_stderr_tail_not_banner():
    """ffmpeg prints a long banner first; the real error is at the end."""
    import sys

    import pytest

    from media_diff.utils.videos import FFmpegError, _run

    script = (
        "import sys\n"
        "sys.stderr.write('banner line\\n' * 30)\n"
        "sys.stderr.write('REAL ERROR: moov atom not found\\n')\n"
        "sys.exit(1)\n"
    )
    with pytest.raises(FFmpegError) as exc:
        _run([sys.executable, "-c", script])
    message = str(exc.value)
    assert "REAL ERROR: moov atom not found" in message
    assert message.count("banner line") < 10  # only the tail is kept


def test_get_video_info_exposes_mtime_and_size(tmp_path, monkeypatch):
    """info carries a content version so the client can cache-bust the stream."""
    from media_diff.utils import videos

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x" * 123)
    monkeypatch.setattr(videos, "probe_video", lambda path: {"codec": "h264"})
    info = videos.get_video_info(str(f))
    assert info["mtime"] == f.stat().st_mtime
    assert info["size"] == 123


def test_video_info_response_is_not_browser_cached(client, tmp_path, monkeypatch):
    """The info response must not be cached, so a changed file yields a new
    stream URL (otherwise playback reuses stale media after an in-place edit)."""
    import media_diff.routers.videos as rv

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")

    def fake_info(_path):
        return {"codec": "h264", "mtime": 111.0, "size": 7}

    monkeypatch.setattr(rv, "get_video_info", fake_info)
    res = client.get("/api/videos/info", params={"path": str(f)})
    assert res.status_code == 200
    assert res.headers.get("cache-control") == "no-store"
    assert res.json()["mtime"] == 111.0


def test_start_transcode_async_joining_running_job_does_not_deadlock(
    tmp_path, monkeypatch
):
    """Regression: joining an in-progress transcode must not self-deadlock.

    ``start_transcode_async`` used to call ``transcode_status()`` while holding
    ``_transcode_states_lock``; ``transcode_status`` -> ``_get_transcode_state``
    re-acquires the same non-reentrant lock on the same thread. On the server
    that thread is the event loop, so the whole process froze and ``media-diff
    status`` reported ``unreachable``.
    """
    import concurrent.futures
    import threading

    from media_diff.utils import videos

    path = str(tmp_path / "clip.mp4")
    key = videos._transcode_key(path)
    monkeypatch.setattr(videos, "_transcode_cache_ready", lambda p: False)

    # Simulate a transcode that is already running (future not done).
    videos._transcode_futures[key] = concurrent.futures.Future()
    videos._transcode_states[key] = {"state": "running", "progress": 0.5, "error": None}

    result: dict = {}

    def run() -> None:
        result["status"] = videos.start_transcode_async(path)

    try:
        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        worker.join(timeout=5.0)
        assert not worker.is_alive(), (
            "start_transcode_async deadlocked on _transcode_states_lock"
        )
        assert result["status"]["state"] == "running"
    finally:
        videos._transcode_futures.pop(key, None)
        videos._transcode_states.pop(key, None)




def test_extract_frame_retries_when_seek_past_eof(tmp_path, monkeypatch):
    """A seek past the real end can make ffmpeg 7 exit -22 ("Could not open
    encoder before EOF") instead of returning an empty image. extract_frame
    must step back a few frames and still return a frame."""
    from media_diff.utils import videos

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        videos, "get_video_info", lambda p: {"duration": 3.0, "fps": 30.0}
    )

    calls: list[float] = []

    def fake_extract(path, t, fps=None):
        calls.append(t)
        if t > 2.9:  # simulate the requested (near-EOF) seek failing
            raise videos.FFmpegError("Could not open encoder before EOF")
        return b"JPEG"

    monkeypatch.setattr(videos, "_extract_jpeg_at", fake_extract)

    out = videos.extract_frame(str(f), 90)  # (90-1)/30 = 2.967s > 2.9s

    assert out == b"JPEG"
    assert calls[0] > 2.9
    assert len(calls) >= 2  # it stepped back instead of failing


def test_extract_frame_low_fps_seek_stays_before_last_frame(tmp_path, monkeypatch):
    """The old flat 0.05s duration clamp landed after the last frame for
    low-fps videos (e.g. the final frame of a 1fps video)."""
    from media_diff.utils import videos

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        videos, "get_video_info", lambda p: {"duration": 3.0, "fps": 1.0}
    )

    seen: list[float] = []

    def fake_extract(path, t, fps=None):
        seen.append(t)
        return b"JPEG"

    monkeypatch.setattr(videos, "_extract_jpeg_at", fake_extract)

    assert videos.extract_frame(str(f), 3) == b"JPEG"
    # duration - 1.5/fps = 3.0 - 1.5 = 1.5; never seek past it.
    assert seen[0] <= 1.5 + 1e-6


def test_extract_frame_raises_when_all_attempts_fail(tmp_path, monkeypatch):
    import pytest

    from media_diff.utils import videos

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        videos, "get_video_info", lambda p: {"duration": 3.0, "fps": 30.0}
    )

    calls: list[float] = []

    def always_no_frame(path, t, fps=None):
        calls.append(t)
        raise videos.FFmpegError("Could not open encoder before EOF")

    monkeypatch.setattr(videos, "_extract_jpeg_at", always_no_frame)

    with pytest.raises(videos.FFmpegError):
        videos.extract_frame(str(f), 10)
    # Bounded: the requested time + the step-backs, no unbounded fallback.
    assert 1 < len(calls) <= 6


def test_extract_frame_does_not_retry_decode_errors(tmp_path, monkeypatch):
    """A real decode/unsupported-codec error must surface immediately instead of
    silently returning a neighbouring frame."""
    import pytest

    from media_diff.utils import videos

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        videos, "get_video_info", lambda p: {"duration": 3.0, "fps": 30.0}
    )

    calls: list[float] = []

    def decode_error(path, t, fps=None):
        calls.append(t)
        raise videos.FFmpegError("Invalid data found when processing input")

    monkeypatch.setattr(videos, "_extract_jpeg_at", decode_error)

    with pytest.raises(videos.FFmpegError):
        videos.extract_frame(str(f), 10)
    assert len(calls) == 1


def test_extract_frame_skips_clamp_when_metadata_inconsistent(
    tmp_path, monkeypatch
):
    """duration vs frame_count mismatch (e.g. a 2.0s clip that really has 26
    frames at 15fps) must not pull the requested frame's seek backwards."""
    from media_diff.utils import videos

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        videos,
        "get_video_info",
        lambda p: {"duration": 2.0, "fps": 15.0, "frame_count": 26},
    )

    seen: list[float] = []

    def fake_extract(path, t, fps=None):
        seen.append(t)
        return b"JPEG"

    monkeypatch.setattr(videos, "_extract_jpeg_at", fake_extract)

    assert videos.extract_frame(str(f), 26) == b"JPEG"
    # frame_count wins over duration: the valid last frame is used as-is.
    assert abs(seen[0] - (26 - 1) / 15) < 1e-9


def test_extract_frame_clamps_out_of_range_to_declared_last(
    tmp_path, monkeypatch
):
    """Out-of-range indices (e.g. the +1/+3 prefetch at the end) map to the
    declared last frame index rather than a duration-derived timestamp."""
    from media_diff.utils import videos

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        videos,
        "get_video_info",
        lambda p: {"duration": 2.0, "fps": 15.0, "frame_count": 30},
    )

    seen: list[float] = []

    def fake_extract(path, t, fps=None):
        seen.append(t)
        return b"JPEG"

    monkeypatch.setattr(videos, "_extract_jpeg_at", fake_extract)

    assert videos.extract_frame(str(f), 31) == b"JPEG"
    assert abs(seen[0] - (30 - 1) / 15) < 1e-9


def test_extract_frame_clamp_does_not_trust_short_duration(
    tmp_path, monkeypatch
):
    """119.88fps clip whose reported duration (3.19s) is slightly shorter than
    383 frames worth (3.1949s): a duration-based margin would land on frame 382.
    The valid last frame must be requested exactly."""
    from media_diff.utils import videos

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        videos,
        "get_video_info",
        lambda p: {"duration": 3.19, "fps": 119.88, "frame_count": 383},
    )

    seen: list[float] = []

    def fake_extract(path, t, fps=None):
        seen.append(t)
        return b"JPEG"

    monkeypatch.setattr(videos, "_extract_jpeg_at", fake_extract)

    assert videos.extract_frame(str(f), 383) == b"JPEG"
    assert abs(seen[0] - (383 - 1) / 119.88) < 1e-9


def test_extract_jpeg_seeks_slightly_before_target(monkeypatch):
    """Formatting the seek with %.3f rounded up past the frame PTS (e.g.
    10/15 -> 0.667), returning the next frame or nothing at the last frame."""
    from media_diff.utils import videos

    captured: dict = {}

    def fake_run(cmd, timeout=60.0):
        captured["cmd"] = cmd
        return b"JPEG"

    monkeypatch.setattr(videos, "_run", fake_run)
    monkeypatch.setattr(videos, "FFMPEG_BIN", "ffmpeg")

    videos._extract_jpeg_at("/x.mp4", 10 / 15)  # frame 11 at 0.6666...

    cmd = captured["cmd"]
    ss = cmd[cmd.index("-ss") + 1]
    assert float(ss) < 10 / 15
    assert abs(float(ss) - (10 / 15 - 0.001)) < 1e-6


def test_extract_jpeg_seek_bias_is_fps_aware(monkeypatch):
    """The 1ms lead must shrink below one frame period for very high fps."""
    from media_diff.utils import videos

    captured: dict = {}

    def fake_run(cmd, timeout=60.0):
        captured["cmd"] = cmd
        return b"JPEG"

    monkeypatch.setattr(videos, "_run", fake_run)
    monkeypatch.setattr(videos, "FFMPEG_BIN", "ffmpeg")

    t = 10.0
    videos._extract_jpeg_at("/x.mp4", t, fps=4000.0)
    cmd = captured["cmd"]
    ss = float(cmd[cmd.index("-ss") + 1])
    assert abs(ss - (t - 0.25 / 4000.0)) < 1e-6
