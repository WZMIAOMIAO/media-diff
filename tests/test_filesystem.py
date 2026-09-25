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
