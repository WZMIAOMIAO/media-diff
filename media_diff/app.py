"""FastAPI application factory and static frontend hosting.

The built frontend (Vite output) is bundled inside the package at
``media_diff/static`` and served by this same app, so a single process and a
single port are enough to run the whole tool.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

import anyio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from media_diff import __version__, config
from media_diff.routers import router as filesystem_router
from media_diff.routers.blind_eval import router as blind_eval_router
from media_diff.routers.images import router as images_router
from media_diff.routers.videos import router as videos_router

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Raise the AnyIO worker threadpool used by FastAPI's sync (`def`) endpoints
    # so that many concurrent users cannot starve the pool (which used to make
    # even the liveness probe time out and the server look unreachable).
    anyio.to_thread.current_default_thread_limiter().total_tokens = (
        config.SYNC_THREAD_LIMIT
    )
    yield


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    # Fail fast when a sandbox root is configured but invalid.
    from media_diff.utils.security import validate_access_root

    validate_access_root()

    app = FastAPI(
        title="Media Diff",
        version=__version__,
        description="Local web tool for side-by-side image and video comparison.",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Histogram"],
    )

    app.include_router(filesystem_router)
    app.include_router(images_router)
    app.include_router(videos_router)
    app.include_router(blind_eval_router)

    @app.get("/api/health", tags=["health"])
    async def health() -> dict:
        # Async on purpose: a sync endpoint runs in the AnyIO worker threadpool,
        # which can be saturated by long blocking requests (image/video work),
        # making the liveness probe time out and the server look unreachable.
        # This handler does no blocking work, so serve it straight on the loop.
        # Report the threadpool size actually in effect (set by the lifespan
        # handler), not just the configured value, so it can be verified live.
        try:
            threads = anyio.to_thread.current_default_thread_limiter().total_tokens
        except Exception:
            threads = config.SYNC_THREAD_LIMIT
        return {
            "status": "ok",
            "service": "media-diff",
            "pid": os.getpid(),
            "version": __version__,
            # Configured access root (sandbox); None means unrestricted.
            "root": config.ACCESS_ROOT or None,
            # Exposed so deployments can confirm the configured concurrency.
            "concurrency": {
                "extract": config.EXTRACT_CONCURRENCY,
                "transcode": config.TRANSCODE_CONCURRENCY,
                "thumbnail": config.THUMBNAIL_CONCURRENCY,
                "probe": config.PROBE_CONCURRENCY,
                "threads": threads,
            },
        }

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        """Serve bundled static assets, falling back to index.html for SPA routes."""
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")

        if not STATIC_DIR.is_dir():
            raise HTTPException(
                status_code=500,
                detail=(
                    "Frontend assets not built. Run `npm run build` "
                    "in the frontend/ directory."
                ),
            )

        if full_path:
            candidate = (STATIC_DIR / full_path).resolve()
            try:
                candidate.relative_to(STATIC_DIR)
            except ValueError:
                raise HTTPException(status_code=404, detail="Not Found")
            if candidate.is_file():
                return FileResponse(candidate)

        return FileResponse(STATIC_DIR / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "media_diff.app:app",
        host=os.environ.get("MEDIA_DIFF_HOST", "127.0.0.1"),
        port=int(os.environ.get("MEDIA_DIFF_PORT", "8000")),
        reload=True,
        timeout_graceful_shutdown=5,
    )
