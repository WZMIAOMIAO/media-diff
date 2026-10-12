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
