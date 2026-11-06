"""Integration tests for frame-accurate extraction.

These run the real ffmpeg (the bundled imageio-ffmpeg) on generated clips and
compare each extracted frame byte-for-byte against ffmpeg's exact per-frame
decode (``-f image2`` of every decoded frame). This covers the positions a user
reaches by dragging the progress bar: first/middle/last frames, the +/- prefetch
window, and indices just past the end.
"""

import hashlib
import os
import subprocess

import pytest

from media_diff.utils import videos


def _ffmpeg():
    if not videos.FFMPEG_BIN:
        pytest.skip("ffmpeg unavailable")
    return videos.FFMPEG_BIN


@pytest.fixture(scope="module")
def make_clip(tmp_path_factory):
    root = tmp_path_factory.mktemp("frame_positions")

    def _make(name, rate, duration=None, frames=None):
        ff = _ffmpeg()
        path = str(root / f"{name}.mp4")
        cmd = [
            ff, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"testsrc=size=160x120:rate={rate}",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        ]
        if frames is not None:
            cmd += ["-frames:v", str(frames)]
        else:
            cmd += ["-t", str(duration)]
        cmd.append(path)
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL,
                           stderr=subprocess.PIPE)
        except (OSError, subprocess.CalledProcessError) as exc:
            pytest.skip(f"cannot generate test clip: {exc}")
        return path

    return _make


def _ground_truth(path, outdir):
    """Every decoded frame as JPEG using the same encoder settings."""
    ff = _ffmpeg()
    os.makedirs(outdir, exist_ok=True)
    cmd = [
        ff, "-hide_banner", "-loglevel", "error", "-i", path,
        "-an", "-sn", "-dn", "-vf", "format=rgb24", "-q:v", "2",
        "-fps_mode", "passthrough", "-start_number", "1",
        "-f", "image2", os.path.join(outdir, "%06d.jpg"),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.PIPE)
    files = sorted(os.listdir(outdir))
    return [
        hashlib.md5(open(os.path.join(outdir, f), "rb").read()).hexdigest()
        for f in files
    ]


def _positions(real):
    picked = set(range(1, min(real, 6) + 1))
    picked.update(range(max(1, real - 5), real + 1))
    for frac in (0.25, 0.5, 0.75, 0.9):
        c = max(1, int(real * frac))
        picked.update(n for n in range(c - 3, c + 4) if 1 <= n <= real)
    if real > 40:
        step = max(1, real // 20)
        picked.update(range(1, real + 1, step))
    return sorted(picked)


@pytest.mark.parametrize(
    "rate,duration,frames",
    [
        (15, 2.0, None),
        (24, 1.0, None),
        (60, 1.0, None),
        (120, 1.0, None),
        (15, None, 26),  # the "26 frames at 15fps" tail case
        (23.976, 1.0, None),
    ],
)
def test_extracted_frames_match_exact_decode(make_clip, tmp_path, rate, duration, frames):
    path = make_clip(f"clip_{rate}_{duration}_{frames}", rate, duration, frames)
    info = videos.get_video_info(path)
    gt = _ground_truth(path, str(tmp_path / "gt"))
    real = len(gt)
    assert real > 0

    for n in _positions(real):
        got = hashlib.md5(videos.extract_frame(path, n)).hexdigest()
        assert got == gt[n - 1], f"frame {n}/{real} (fps={info['fps']}) mismatch"

    # Out-of-range indices (prefetch past the end / clamped max) must not error
    # and must resolve to the last real frame.
    last = gt[-1]
    for n in (real + 1, real + 2, real + 3, real + 10):
        got = hashlib.md5(videos.extract_frame(path, n)).hexdigest()
        assert got == last, f"out-of-range frame {n}/{real} did not fall back to last"
