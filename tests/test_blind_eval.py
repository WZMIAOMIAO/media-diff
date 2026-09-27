import json
import os

import pytest
from PIL import Image

from media_diff.utils import blind_eval


def make_folder(path, names):
    path.mkdir(parents=True, exist_ok=True)
    for name in names:
        Image.new("RGB", (8, 8), (1, 2, 3)).save(path / name)
    return path


@pytest.fixture
def folders(tmp_path):
    names = ["img_00.png", "img_01.png", "img_02.png", "img_03.png", "img_04.png"]
    a = make_folder(tmp_path / "A", names)
    b = make_folder(tmp_path / "B", names)
    c = make_folder(tmp_path / "C", list(reversed(names)))
    return [str(a), str(b), str(c)]


def test_resolve_output_dir(tmp_path):
    out = blind_eval.resolve_output_path(str(tmp_path))
    assert out == os.path.join(str(tmp_path), "blind_review_results.json")


def test_resolve_output_file(tmp_path):
    target = os.path.join(str(tmp_path), "custom.json")
    assert blind_eval.resolve_output_path(target) == target


def test_resolve_output_missing_dir(tmp_path):
    with pytest.raises(blind_eval.BlindEvalError):
        blind_eval.resolve_output_path(str(tmp_path / "missing"))


def test_common_file_names(folders):
    assert blind_eval.common_file_names(folders) == [
        "img_00.png",
        "img_01.png",
        "img_02.png",
        "img_03.png",
        "img_04.png",
    ]


def test_split_floor_and_last_remainder():
    names = [f"{i}.png" for i in range(11)]
    # 11 items into 3 parts -> 3,3,5
    assert blind_eval._split(names, 3, 1) == names[:3]
    assert blind_eval._split(names, 3, 2) == names[3:6]
    assert blind_eval._split(names, 3, 3) == names[6:]


def test_split_more_parts_than_items():
    with pytest.raises(blind_eval.BlindEvalError):
        blind_eval._split(["a.png"], 3, 1)


def test_setup_fresh_creates_file(folders, tmp_path):
    out = str(tmp_path / "blind_review_results.json")
    result = blind_eval.setup(folders, 1, 1, 1234, out)
    assert result["existing_file_matched"] is False
    assert result["aliases"][folders[0]] == "A"
    assert result["aliases"][folders[2]] == "C"
    assert sorted(result["common_files"]) == sorted(
        f"img_0{i}.png" for i in range(5)
    )
    # every image has a per-window permutation covering all folders
    for name, order in result["display_orders"].items():
        assert sorted(order) == [0, 1, 2]
    data = json.loads(open(out, encoding="utf-8").read())
    assert data["A_win_list"] == []
    assert data[folders[0]] == "A"


def test_setup_existing_match_requires_confirm(folders, tmp_path):
    out = str(tmp_path / "blind_review_results.json")
    blind_eval.setup(folders, 1, 1, 1234, out)
    second = blind_eval.setup(folders, 1, 1, 1234, out)
    assert second["existing_file_matched"] is True


def test_setup_existing_mismatch(folders, tmp_path):
    out = str(tmp_path / "blind_review_results.json")
    blind_eval.setup(folders, 1, 1, 1234, out)
    other = make_folder(tmp_path / "D", ["img_00.png"])
    with pytest.raises(blind_eval.BlindEvalError) as exc:
        blind_eval.setup(folders[:1] + [str(other)], 1, 1, 1234, out)
    assert exc.value.status_code == 409


def test_setup_load_existing(folders, tmp_path):
    out = str(tmp_path / "blind_review_results.json")
    blind_eval.setup(folders, 1, 1, 1234, out)
    blind_eval.vote(out, "img_00.png", "A")
    loaded = blind_eval.setup(folders, 1, 1, 1234, out, load_existing=True)
    assert loaded["existing_file_matched"] is False
    assert loaded["win_lists"]["A"] == ["img_00.png"]


def test_vote_moves_between_aliases(folders, tmp_path):
    out = str(tmp_path / "blind_review_results.json")
    blind_eval.setup(folders, 1, 1, 1234, out)
    blind_eval.vote(out, "img_00.png", "A")
    data = blind_eval.vote(out, "img_00.png", "B")
    assert data["A_win_list"] == []
    assert data["B_win_list"] == ["img_00.png"]
    data = blind_eval.vote(out, "img_00.png", None)
    assert data["B_win_list"] == []


def test_missing_common_files_raises(tmp_path):
    a = make_folder(tmp_path / "A", ["x.png"])
    b = make_folder(tmp_path / "B", ["y.png"])
    with pytest.raises(blind_eval.BlindEvalError):
        blind_eval.setup([str(a), str(b)], 1, 1, 1234, str(tmp_path))


def test_api_setup_and_vote(client, folders, tmp_path):
    out = str(tmp_path / "blind_review_results.json")
    res = client.post(
        "/api/blind-eval/setup",
        json={
            "paths": folders,
            "total_parts": 1,
            "current_part": 1,
            "seed": 7,
            "output_path": out,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["existing_file_matched"] is False

    name = body["common_files"][0]
    res = client.post(
        "/api/blind-eval/vote",
        json={"output_path": out, "image_name": name, "alias": "A"},
    )
    assert res.status_code == 200
    assert res.json()["data"]["A_win_list"] == [name]

    res = client.post("/api/blind-eval/load", json={"output_path": out})
    assert res.status_code == 200
    assert res.json()["data"]["A_win_list"] == [name]
