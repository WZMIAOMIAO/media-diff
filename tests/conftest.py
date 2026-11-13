import pytest
from fastapi.testclient import TestClient
from PIL import Image

from media_diff import config
from media_diff.app import app


@pytest.fixture(autouse=True)
def _clear_access_roots(monkeypatch):
    """Tests start unrestricted; root-specific tests patch config themselves.

    Without this, a developer shell that exports ``MEDIA_DIFF_ROOT`` would make
    the single-root tests (which patch ``config.ACCESS_ROOT``) silently use the
    ambient roots instead.
    """
    monkeypatch.setattr(config, "ACCESS_ROOTS", [])
    monkeypatch.setattr(config, "ACCESS_ROOT", None)


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def image_dir(tmp_path):
    """A temp folder with two supported images and one ignored text file."""
    folder = tmp_path / "images"
    folder.mkdir()
    Image.new("RGB", (40, 30), (10, 20, 30)).save(folder / "a.png")
    Image.new("RGB", (60, 20), (200, 100, 50)).save(folder / "b.jpg")
    (folder / "notes.txt").write_text("ignored")
    return folder
