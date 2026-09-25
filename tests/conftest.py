import pytest
from fastapi.testclient import TestClient
from PIL import Image

from media_diff.app import app


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
