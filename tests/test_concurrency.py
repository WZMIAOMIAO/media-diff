import asyncio

from media_diff import config
from media_diff.utils import pool


def test_env_int_reads_and_falls_back(monkeypatch):
    assert config._env_int("MEDIA_DIFF_TEST_MISSING", 4) == 4
    monkeypatch.setenv("MEDIA_DIFF_TEST_INT", "12")
    assert config._env_int("MEDIA_DIFF_TEST_INT", 4) == 12
    monkeypatch.setenv("MEDIA_DIFF_TEST_INT", "0")
    assert config._env_int("MEDIA_DIFF_TEST_INT", 4) == 4
    monkeypatch.setenv("MEDIA_DIFF_TEST_INT", "bad")
    assert config._env_int("MEDIA_DIFF_TEST_INT", 4) == 4


def test_executor_workers_match_config():
    assert pool.executor_workers("extract") == config.EXTRACT_CONCURRENCY
    assert pool.executor_workers("transcode") == config.TRANSCODE_CONCURRENCY
    assert pool.executor_workers("thumbnail") == config.THUMBNAIL_CONCURRENCY
    assert pool.executor_workers("probe") == config.PROBE_CONCURRENCY


def test_run_ffmpeg_executes_in_purpose_executor():
    async def main():
        return await pool.run_ffmpeg("probe", lambda: 40 + 2)

    assert asyncio.run(main()) == 42
