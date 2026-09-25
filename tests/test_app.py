import pytest

from media_diff.app import STATIC_DIR


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_unknown_api_returns_404(client):
    assert client.get("/api/does-not-exist").status_code == 404


@pytest.mark.skipif(
    not (STATIC_DIR / "index.html").is_file(),
    reason="frontend not built (run `npm run build` in frontend/)",
)
def test_root_serves_spa(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]


@pytest.mark.skipif(
    not (STATIC_DIR / "index.html").is_file(),
    reason="frontend not built (run `npm run build` in frontend/)",
)
def test_spa_fallback_for_client_routes(client):
    res = client.get("/video")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]


def test_path_traversal_is_blocked(client):
    res = client.get("/../../etc/passwd")
    assert res.status_code in (200, 404)
    if res.status_code == 200:
        assert "root:" not in res.text
