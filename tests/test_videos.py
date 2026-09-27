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
