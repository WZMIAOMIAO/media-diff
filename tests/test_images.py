import base64
import json


def test_thumbnail_returns_jpeg_and_histogram(client, image_dir):
    path = str(image_dir / "a.png")
    res = client.get("/api/images/thumbnail", params={"path": path})
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/jpeg"
    hist = json.loads(base64.b64decode(res.headers["X-Histogram"]))
    assert len(hist["r"]) == 256
    assert len(hist["g"]) == 256
    assert len(hist["b"]) == 256


def test_view_returns_file(client, image_dir):
    path = str(image_dir / "b.jpg")
    res = client.get("/api/images/view", params={"path": path})
    assert res.status_code == 200
    assert len(res.content) > 0


def test_unsupported_extension(client, tmp_path):
    bad = tmp_path / "file.txt"
    bad.write_text("not an image")
    res = client.get("/api/images/view", params={"path": str(bad)})
    assert res.status_code == 400


def test_missing_file(client, tmp_path):
    res = client.get(
        "/api/images/view", params={"path": str(tmp_path / "missing.png")}
    )
    assert res.status_code == 404
