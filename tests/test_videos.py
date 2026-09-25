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
