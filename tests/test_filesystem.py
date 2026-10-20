def test_roots(client):
    res = client.get("/api/filesystem/roots")
    assert res.status_code == 200
    assert isinstance(res.json()["roots"], list)


def test_home(client):
    res = client.get("/api/filesystem/home")
    assert res.status_code == 200
    assert res.json()["path"]


def test_browse_lists_images(client, image_dir):
    res = client.post("/api/filesystem/browse", json={"path": str(image_dir)})
    assert res.status_code == 200
    names = [f["name"] for f in res.json()["images"]]
    assert names == ["a.png", "b.jpg"]


def test_browse_missing_path(client, tmp_path):
    res = client.post(
        "/api/filesystem/browse", json={"path": str(tmp_path / "nope")}
    )
    assert res.status_code == 404


def test_browse_relative_path_returns_absolute(client, tmp_path, monkeypatch):
    import os

    root = tmp_path / "data"
    (root / "sub").mkdir(parents=True)
    monkeypatch.chdir(tmp_path)
    res = client.post("/api/filesystem/browse", json={"path": "data"})
    assert res.status_code == 200
    body = res.json()
    # A relative input must be resolved to a full absolute path so downstream
    # nodes (and compared folders) never carry an incomplete relative path.
    assert os.path.isabs(body["path"])
    assert body["path"] == os.path.abspath(root)
    assert all(os.path.isabs(s["path"]) for s in body["subdirs"])


def test_list_images_endpoint(client, image_dir):
    res = client.post("/api/filesystem/images", json={"path": str(image_dir)})
    assert res.status_code == 200
    assert len(res.json()["images"]) == 2


def _make_video_tree(root):
    """Build a small video tree with nesting and entries to ignore."""
    root.mkdir(parents=True)
    (root / "root.mp4").write_bytes(b"")
    sub = root / "sub"
    sub.mkdir()
    (sub / "a.mp4").write_bytes(b"")
    (sub / "note.txt").write_bytes(b"")
    deep = sub / "deep"
    deep.mkdir()
    (deep / "b.mkv").write_bytes(b"")
    hidden = root / ".hidden"
    hidden.mkdir()
    (hidden / "secret.mp4").write_bytes(b"")
    (root / ".dot.mp4").write_bytes(b"")
    return root


def test_list_videos_non_recursive_has_no_rel(client, tmp_path):
    root = _make_video_tree(tmp_path / "videos")
    res = client.post("/api/filesystem/videos", json={"path": str(root)})
    assert res.status_code == 200
    videos = res.json()["videos"]
    # non-recursive keeps its legacy behaviour (immediate files only, dot
    # files included) and must not add the recursive-only ``rel`` field
    assert [v["name"] for v in videos] == [".dot.mp4", "root.mp4"]
    assert all("rel" not in v for v in videos)


def test_list_videos_recursive_returns_sorted_rel(client, tmp_path):
    root = _make_video_tree(tmp_path / "videos")
    res = client.post(
        "/api/filesystem/videos", json={"path": str(root), "recursive": True}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["truncated"] is False
    assert [v["rel"] for v in body["videos"]] == [
        "root.mp4",
        "sub/a.mp4",
        "sub/deep/b.mkv",
    ]
    # hidden directories/files are skipped entirely
    assert all(".hidden" not in v["path"] for v in body["videos"])


def _make_image_tree(root):
    """Build a small image tree with nesting and entries to ignore."""
    from PIL import Image

    root.mkdir(parents=True)
    Image.new("RGB", (8, 8)).save(root / "root.png")
    sub = root / "sub"
    sub.mkdir()
    Image.new("RGB", (8, 8)).save(sub / "a.jpg")
    (sub / "note.txt").write_text("ignored")
    deep = sub / "deep"
    deep.mkdir()
    Image.new("RGB", (8, 8)).save(deep / "b.png")
    hidden = root / ".hidden"
    hidden.mkdir()
    Image.new("RGB", (8, 8)).save(hidden / "secret.png")
    return root


def test_list_images_recursive_returns_sorted_rel(client, tmp_path):
    root = _make_image_tree(tmp_path / "images")
    res = client.post(
        "/api/filesystem/images", json={"path": str(root), "recursive": True}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["truncated"] is False
    assert [i["rel"] for i in body["images"]] == [
        "root.png",
        "sub/a.jpg",
        "sub/deep/b.png",
    ]
    assert all(".hidden" not in i["path"] for i in body["images"])


def test_natural_sort_key_numeric_aware():
    from media_diff.utils.filesystem import natural_sort_key

    names = ["iter_10", "iter_2", "iter_1", "exp_a10", "exp_a2", "exp_a1"]
    assert sorted(names, key=natural_sort_key) == [
        "exp_a1",
        "exp_a2",
        "exp_a10",
        "iter_1",
        "iter_2",
        "iter_10",
    ]


def test_natural_sort_is_case_insensitive():
    from media_diff.utils.filesystem import natural_sort_key

    assert sorted(["B", "a", "c"], key=natural_sort_key) == ["a", "B", "c"]


def test_browse_subdirs_sorted_naturally(client, tmp_path):
    root = tmp_path / "exp"
    for name in ["iter_10", "iter_2", "iter_1", "baseline"]:
        (root / name).mkdir(parents=True)
    res = client.post("/api/filesystem/browse", json={"path": str(root)})
    assert res.status_code == 200
    names = [s["name"] for s in res.json()["subdirs"]]
    assert names == ["baseline", "iter_1", "iter_2", "iter_10"]


def test_list_images_non_recursive_has_no_rel(client, tmp_path):
    root = _make_image_tree(tmp_path / "images")
    res = client.post("/api/filesystem/images", json={"path": str(root)})
    assert res.status_code == 200
    images = res.json()["images"]
    assert [i["name"] for i in images] == ["root.png"]
    assert all("rel" not in i for i in images)


def test_download_file_sets_attachment_and_filename(client, image_dir):
    src = image_dir / "a.png"
    res = client.get("/api/filesystem/download", params={"path": str(src)})
    assert res.status_code == 200
    disposition = res.headers["content-disposition"]
    assert "attachment" in disposition
    assert "a.png" in disposition
    # Original bytes are streamed unchanged (no re-encoding).
    assert res.content == src.read_bytes()


def test_download_directory_is_rejected(client, image_dir):
    res = client.get("/api/filesystem/download", params={"path": str(image_dir)})
    assert res.status_code == 400


def test_download_head_validates_without_body(client, image_dir):
    # The client preflights single-file downloads with HEAD; it must report the
    # attachment/filename but send no body.
    res = client.head(
        "/api/filesystem/download", params={"path": str(image_dir / "a.png")}
    )
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"]
    assert res.content == b""
    missing = client.head(
        "/api/filesystem/download", params={"path": str(image_dir / "nope.png")}
    )
    assert missing.status_code == 404


def test_download_missing_returns_404(client, tmp_path):
    res = client.get(
        "/api/filesystem/download", params={"path": str(tmp_path / "nope.png")}
    )
    assert res.status_code == 404


def test_download_outside_root_403(client, tmp_path, monkeypatch):
    from media_diff import config

    root = tmp_path / "data"
    root.mkdir()
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"x")
    monkeypatch.setattr(config, "ACCESS_ROOT", str(root))
    res = client.get("/api/filesystem/download", params={"path": str(outside)})
    assert res.status_code == 403


def _make_download_tree(root):
    root.mkdir()
    (root / "a.txt").write_bytes(b"a")
    (root / ".dot.txt").write_bytes(b"d")
    (root / "empty").mkdir()
    sub = root / "sub"
    sub.mkdir()
    (sub / "b.jpg").write_bytes(b"b")
    return root


def _wait_zip(client, job_id, timeout=15.0):
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        res = client.get("/api/filesystem/zip-status", params={"job_id": job_id})
        assert res.status_code == 200
        status = res.json()
        if status["state"] in ("done", "error"):
            return status
        time.sleep(0.05)
    raise AssertionError("zip job did not finish in time")


def test_prepare_zip_and_download_structured_zip(client, tmp_path):
    import io
    import zipfile

    root = _make_download_tree(tmp_path / "dl")
    res = client.post("/api/filesystem/prepare-zip", json={"path": str(root)})
    assert res.status_code == 200
    body = res.json()
    assert body["too_many"] is False
    assert body["total"] == 5
    assert body["filename"] == "dl.zip"

    status = _wait_zip(client, body["job_id"])
    assert status["state"] == "done"
    assert status["progress"] == 1.0
    assert status["total"] == 5

    dl = client.get(
        "/api/filesystem/download-zip", params={"job_id": body["job_id"]}
    )
    assert dl.status_code == 200
    assert dl.headers["content-type"].startswith("application/zip")
    assert "attachment" in dl.headers["content-disposition"]
    assert "dl.zip" in dl.headers["content-disposition"]

    with zipfile.ZipFile(io.BytesIO(dl.content)) as zf:
        names = set(zf.namelist())
        # Structure preserved under a top-level folder named after the source.
        assert "dl/a.txt" in names
        assert "dl/.dot.txt" in names  # hidden entries included
        assert "dl/sub/b.jpg" in names
        assert "dl/empty/" in names  # empty directory preserved
        assert zf.read("dl/a.txt") == b"a"

    # The file is kept for a grace period so a paused download can resume via
    # Range requests; an immediate re-download therefore still succeeds.
    again = client.get(
        "/api/filesystem/download-zip", params={"job_id": body["job_id"]}
    )
    assert again.status_code == 200
    assert again.content == dl.content


def test_download_zip_supports_range_resume(client, tmp_path):
    """Partial (Range) responses must not invalidate the job (pause/resume)."""
    root = _make_download_tree(tmp_path / "dl")
    body = client.post(
        "/api/filesystem/prepare-zip", json={"path": str(root)}
    ).json()
    assert _wait_zip(client, body["job_id"])["state"] == "done"

    first = client.get(
        "/api/filesystem/download-zip",
        params={"job_id": body["job_id"]},
        headers={"Range": "bytes=0-99"},
    )
    assert first.status_code == 206
    assert len(first.content) == 100

    # Simulate the browser resuming after a pause with a second Range request.
    second = client.get(
        "/api/filesystem/download-zip",
        params={"job_id": body["job_id"]},
        headers={"Range": "bytes=100-199"},
    )
    assert second.status_code == 206
    assert len(second.content) == 100

    full = client.get(
        "/api/filesystem/download-zip", params={"job_id": body["job_id"]}
    )
    assert full.status_code == 200
    assert full.content[:100] == first.content
    assert full.content[100:200] == second.content


def test_prepare_same_folder_shares_one_job(client, tmp_path):
    import io
    import zipfile

    root = _make_download_tree(tmp_path / "dl")
    a = client.post("/api/filesystem/prepare-zip", json={"path": str(root)}).json()
    b = client.post("/api/filesystem/prepare-zip", json={"path": str(root)}).json()
    # Concurrent requests for the same folder share one compression job, so both
    # clients poll the same id (same progress) and download the same file.
    assert a["job_id"] == b["job_id"]
    assert _wait_zip(client, a["job_id"])["state"] == "done"

    da = client.get("/api/filesystem/download-zip", params={"job_id": a["job_id"]})
    db = client.get("/api/filesystem/download-zip", params={"job_id": b["job_id"]})
    assert da.status_code == 200
    assert db.status_code == 200
    assert da.content == db.content
    with zipfile.ZipFile(io.BytesIO(da.content)) as zf:
        assert "dl/a.txt" in zf.namelist()


def test_prepare_reuses_until_folder_changes(client, tmp_path):
    root = _make_download_tree(tmp_path / "dl")
    a = client.post("/api/filesystem/prepare-zip", json={"path": str(root)}).json()
    # A new entry changes the folder mtime -> a fresh job is started.
    import os
    import time

    time.sleep(0.01)
    (root / "new.txt").write_bytes(b"n")
    os.utime(root, None)
    b = client.post("/api/filesystem/prepare-zip", json={"path": str(root)}).json()
    assert a["job_id"] != b["job_id"]


def test_zip_uses_store_compression_by_default(client, tmp_path):
    import io
    import zipfile

    # Media is already compressed, so the default must store entries verbatim
    # (deflate is ~10x slower for negligible size gain).
    root = _make_download_tree(tmp_path / "dl")
    body = client.post("/api/filesystem/prepare-zip", json={"path": str(root)}).json()
    assert _wait_zip(client, body["job_id"])["state"] == "done"
    dl = client.get("/api/filesystem/download-zip", params={"job_id": body["job_id"]})
    with zipfile.ZipFile(io.BytesIO(dl.content)) as zf:
        assert zf.infolist()
        assert all(i.compress_type == zipfile.ZIP_STORED for i in zf.infolist())


def test_prepare_zip_reports_real_total_when_too_many(client, tmp_path):
    from media_diff.utils.filesystem import MAX_DOWNLOAD_ENTRIES

    root = tmp_path / "big"
    root.mkdir()
    over = MAX_DOWNLOAD_ENTRIES + 5
    for i in range(over):
        (root / f"f{i}.txt").write_bytes(b"")
    res = client.post("/api/filesystem/prepare-zip", json={"path": str(root)})
    assert res.status_code == 200
    body = res.json()
    assert body["too_many"] is True
    assert body["total"] == over
    assert "job_id" not in body


def test_prepare_zip_missing_404(client, tmp_path):
    res = client.post(
        "/api/filesystem/prepare-zip", json={"path": str(tmp_path / "nope")}
    )
    assert res.status_code == 404


def test_prepare_zip_outside_root_403(client, tmp_path, monkeypatch):
    from media_diff import config

    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setattr(config, "ACCESS_ROOT", str(root))
    res = client.post("/api/filesystem/prepare-zip", json={"path": str(tmp_path)})
    assert res.status_code == 403


def test_zip_status_unknown_job_404(client):
    res = client.get("/api/filesystem/zip-status", params={"job_id": "nope"})
    assert res.status_code == 404


def test_download_zip_unknown_job_409(client):
    res = client.get("/api/filesystem/download-zip", params={"job_id": "nope"})
    assert res.status_code == 409


def test_cancel_zip_unknown_job_404(client):
    res = client.post("/api/filesystem/cancel-zip", json={"job_id": "nope"})
    assert res.status_code == 404
