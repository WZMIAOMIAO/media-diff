from media_diff.routers.filesystem import router
from media_diff.routers.images import router as images_router
from media_diff.routers.videos import router as videos_router

__all__ = ["router", "images_router", "videos_router"]
