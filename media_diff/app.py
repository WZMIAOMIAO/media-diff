"""FastAPI application factory and static frontend hosting.

The built frontend (Vite output) is bundled inside the package at
``media_diff/static`` and served by this same app, so a single process and a
single port are enough to run the whole tool.
"""

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from media_diff import __version__
from media_diff.routers import router as filesystem_router
from media_diff.routers.blind_eval import router as blind_eval_router
from media_diff.routers.images import router as images_router
from media_diff.routers.videos import router as videos_router

STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    app = FastAPI(
        title="Media Diff",
        version=__version__,
        description="Local web tool for side-by-side image and video comparison.",
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
    def health() -> dict:
        from media_diff import config

        return {
            "status": "ok",
            "service": "media-diff",
            "version": __version__,
            # Exposed so deployments can confirm the configured ffmpeg concurrency.
            "concurrency": {
                "extract": config.EXTRACT_CONCURRENCY,
                "transcode": config.TRANSCODE_CONCURRENCY,
                "thumbnail": config.THUMBNAIL_CONCURRENCY,
                "probe": config.PROBE_CONCURRENCY,
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
