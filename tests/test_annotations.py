import json
import os

import pytest

from media_diff.utils import annotations


def entry(images, question, answer):
    return {
        "image": list(images),
        "question": question,
        "answer": answer,
    }


def test_resolve_output_dir(tmp_path):
    out = annotations.resolve_output_path(str(tmp_path))
    assert out == os.path.join(str(tmp_path), "annotation_results.json")


def test_resolve_output_dir_video(tmp_path):
    out = annotations.resolve_output_path(str(tmp_path), media="video")
    assert out == os.path.join(str(tmp_path), "video_annotation_results.json")


def test_resolve_output_file(tmp_path):
    target = os.path.join(str(tmp_path), "custom.json")
    assert annotations.resolve_output_path(target) == target


def test_resolve_output_missing_dir(tmp_path):
    with pytest.raises(annotations.AnnotationError) as exc:
        annotations.resolve_output_path(str(tmp_path / "missing"))
    assert exc.value.status_code == 404


def test_resolve_output_empty():
    with pytest.raises(annotations.AnnotationError):
        annotations.resolve_output_path("   ")


def test_check_path_dir_and_file(tmp_path):
    result = annotations.check_path(str(tmp_path))
    assert result["path"] == os.path.join(str(tmp_path), "annotation_results.json")
    assert result["exists"] is False
    assert result["writable"] is True


def test_check_path_existing_file(tmp_path):
    target = tmp_path / "anno.json"
    target.write_text("[]", encoding="utf-8")
    result = annotations.check_path(str(target))
    assert result["path"] == str(target)
    assert result["exists"] is True


def test_save_appends_new_entries(tmp_path):
    out = str(tmp_path)
    annotations.save(out, [entry(["a.png", "b.png"], "q1", "r1")])
    data = annotations.save(out, [entry(["c.png", "d.png"], "q1", "r2")])
    assert len(data) == 2
    written = json.loads((tmp_path / "annotation_results.json").read_text(encoding="utf-8"))
    assert written == data
    assert written[0]["image"] == ["a.png", "b.png"]
    assert written[1]["answer"] == "r2"


def test_save_replaces_same_image_and_question(tmp_path):
    out = str(tmp_path)
    annotations.save(out, [entry(["a.png", "b.png"], "q1", "old")])
    data = annotations.save(out, [entry(["a.png", "b.png"], "q1", "new")])
    assert len(data) == 1
    assert data[0]["answer"] == "new"


def test_save_keeps_entries_with_different_question(tmp_path):
    out = str(tmp_path)
    annotations.save(out, [entry(["a.png", "b.png"], "q1", "r1")])
    data = annotations.save(out, [entry(["a.png", "b.png"], "q2", "r2")])
    assert len(data) == 2
    assert {e["question"] for e in data} == {"q1", "q2"}


def test_save_preserves_order_on_replace(tmp_path):
    out = str(tmp_path)
    annotations.save(
        out,
        [
            entry(["a.png"], "q", "1"),
            entry(["b.png"], "q", "2"),
        ],
    )
    data = annotations.save(out, [entry(["a.png"], "q", "updated")])
    assert [e["image"] for e in data] == [["a.png"], ["b.png"]]
    assert data[0]["answer"] == "updated"


def test_save_rejects_bad_entry(tmp_path):
    with pytest.raises(annotations.AnnotationError):
        annotations.save(str(tmp_path), [{"question": "q", "answer": "a"}])


def test_save_rejects_empty_question(tmp_path):
    with pytest.raises(annotations.AnnotationError):
        annotations.save(str(tmp_path), [entry(["a.png"], "   ", "r")])


def test_save_rejects_empty_result(tmp_path):
    with pytest.raises(annotations.AnnotationError):
        annotations.save(str(tmp_path), [entry(["a.png"], "q", "  ")])


def test_api_save_rejects_empty_strings(client, tmp_path):
    target = str(tmp_path / "anno.json")
    res = client.post(
        "/api/annotations/save",
        json={"save_path": target, "annotations": [entry(["a.png"], "q", "")]},
    )
    assert res.status_code == 400
    assert not os.path.exists(target)


def test_load_missing_returns_empty(tmp_path):
    assert annotations.load(str(tmp_path)) == []


def test_api_check_load_save(client, tmp_path):
    target = str(tmp_path / "anno.json")

    res = client.post("/api/annotations/check-path", json={"path": str(tmp_path)})
    assert res.status_code == 200
    body = res.json()
    assert body["path"] == os.path.join(str(tmp_path), "annotation_results.json")
    assert body["exists"] is False

    payload = entry(["a.png", "b.png"], "which is better?", "left")
    res = client.post(
        "/api/annotations/save",
        json={"save_path": target, "annotations": [payload]},
    )
    assert res.status_code == 200
    assert res.json()["data"] == [payload]

    res = client.post("/api/annotations/load", json={"save_path": target})
    assert res.status_code == 200
    assert res.json()["data"] == [payload]


def test_api_missing_dir_returns_404(client, tmp_path):
    res = client.post(
        "/api/annotations/check-path",
        json={"path": str(tmp_path / "missing")},
    )
    assert res.status_code == 404


def video_entry(videos, question, answer):
    return {"video": list(videos), "question": question, "answer": answer}


def test_save_video_entry(tmp_path):
    data = annotations.save(str(tmp_path), [video_entry(["a.mp4", "b.mp4"], "q", "left")])
    assert data[0]["video"] == ["a.mp4", "b.mp4"]


def test_save_image_and_video_entries_coexist(tmp_path):
    out = str(tmp_path)
    annotations.save(out, [entry(["a.png"], "q", "1")])
    data = annotations.save(out, [video_entry(["a.mp4"], "q", "2")])
    assert len(data) == 2


def test_api_save_video_media(client, tmp_path):
    res = client.post(
        "/api/annotations/save",
        json={
            "save_path": str(tmp_path),
            "annotations": [video_entry(["a.mp4"], "q", "left")],
            "media": "video",
        },
    )
    assert res.status_code == 200
    assert res.json()["data"][0]["video"] == ["a.mp4"]
    assert (tmp_path / "video_annotation_results.json").is_file()
