from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import logging
import logging.handlers
import time
from pathlib import Path
import os
import atexit
import sys
import redis
import socket
from urllib.parse import urlparse

# Import route routers (to be created)
from routes.auth.credentials import router as credentials_router
from routes.auth.auth import router as auth_router
from routes.content.artist import router as artist_router
from routes.content.album import router as album_router
from routes.content.track import router as track_router
from routes.content.playlist import router as playlist_router
from routes.core.search import router as search_router
from routes.core.history import router as history_router
from routes.system.progress import router as prgs_router
from routes.system.config import router as config_router


# Import Celery configuration and manager
from routes.utils.celery_manager import celery_manager
from routes.utils.celery_config import REDIS_URL

# Import authentication system
from routes.auth import AUTH_ENABLED
from routes.auth.middleware import AuthMiddleware

# Import and initialize routes (this will start the watch manager)
import routes


# Configure application-wide logging
def setup_logging():
    """Configure application-wide logging with rotation"""
    # Create logs directory if it doesn't exist
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)

    # Set up log file paths
    main_log = logs_dir / "spotizerr.log"

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Clear any existing handlers from the root logger
    if root_logger.hasHandlers():
        root_logger.handlers.clear()

    # Log formatting
    log_format = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # File handler with rotation (10 MB max, keep 5 backups)
    file_handler = logging.handlers.RotatingFileHandler(
        main_log, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(log_format)
    file_handler.setLevel(logging.INFO)

    # Console handler for stderr
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setFormatter(log_format)
    console_handler.setLevel(logging.INFO)

    # Add handlers to root logger
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)

    # Set up specific loggers
    for logger_name in [
        "routes",
        "routes.utils",
        "routes.utils.celery_manager",
        "routes.utils.celery_tasks",
        "routes.utils.watch",
    ]:
        logger = logging.getLogger(logger_name)
        logger.setLevel(logging.INFO)
        logger.propagate = True  # Propagate to root logger

    logging.info("Logging system initialized")


def check_redis_connection():
    """Check if Redis is available and accessible"""
    if not REDIS_URL:
        logging.error("REDIS_URL is not configured. Please check your environment.")
        return False

    try:
        # Parse Redis URL
        parsed_url = urlparse(REDIS_URL)
        host = parsed_url.hostname or "localhost"
        port = parsed_url.port or 6379

        logging.info(f"Testing Redis connection to {host}:{port}...")

        # Test socket connection first
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex((host, port))
        sock.close()

        if result != 0:
            logging.error(f"Cannot connect to Redis at {host}:{port}")
            return False

        # Test Redis client connection
        r = redis.from_url(REDIS_URL, socket_connect_timeout=5, socket_timeout=5)
        r.ping()
        logging.info("Redis connection successful")
        return True

    except redis.ConnectionError as e:
        logging.error(f"Redis connection error: {e}")
        return False
    except redis.TimeoutError as e:
        logging.error(f"Redis timeout error: {e}")
        return False
    except Exception as e:
        logging.error(f"Unexpected error checking Redis connection: {e}")
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown"""
    # Startup
    setup_logging()
    
    # Check Redis connection
    if not check_redis_connection():
        logging.error("Failed to connect to Redis. Please ensure Redis is running and accessible.")
        # Don't exit, but warn - some functionality may not work
    
    # Start Celery workers
    try:
        celery_manager.start()
        logging.info("Celery workers started successfully")
    except Exception as e:
        logging.error(f"Failed to start Celery workers: {e}")
    
    yield
    
    # Shutdown
    try:
        celery_manager.stop()
        logging.info("Celery workers stopped")
    except Exception as e:
        logging.error(f"Error stopping Celery workers: {e}")


def create_app():
    app = FastAPI(
        title="Spotizerr API",
        description="Music download service API",
        version="1.0.0",
        lifespan=lifespan,
        redirect_slashes=True  # Enable automatic trailing slash redirects
    )

    # Set up CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Add authentication middleware (only if auth is enabled)
    if AUTH_ENABLED:
        app.add_middleware(AuthMiddleware)
        logging.info("Authentication system enabled")
    else:
        logging.info("Authentication system disabled")

    # Register routers with URL prefixes
    app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
    
    # Include SSO router if available
    try:
        from routes.auth.sso import router as sso_router
        app.include_router(sso_router, prefix="/api/auth", tags=["sso"])
        logging.info("SSO functionality enabled")
    except ImportError as e:
        logging.warning(f"SSO functionality not available: {e}")
    app.include_router(config_router, prefix="/api/config", tags=["config"])
    app.include_router(search_router, prefix="/api/search", tags=["search"])
    app.include_router(credentials_router, prefix="/api/credentials", tags=["credentials"])
    app.include_router(album_router, prefix="/api/album", tags=["album"])
    app.include_router(track_router, prefix="/api/track", tags=["track"])
    app.include_router(playlist_router, prefix="/api/playlist", tags=["playlist"])
    app.include_router(artist_router, prefix="/api/artist", tags=["artist"])
    app.include_router(prgs_router, prefix="/api/prgs", tags=["progress"])
    app.include_router(history_router, prefix="/api/history", tags=["history"])

    # Add request logging middleware
    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start_time = time.time()
        
        # Log request
        logger = logging.getLogger("uvicorn.access")
        logger.debug(f"Request: {request.method} {request.url.path}")
        
        try:
            response = await call_next(request)
            
            # Log response
            duration = round((time.time() - start_time) * 1000, 2)
            logger.debug(f"Response: {response.status_code} | Duration: {duration}ms")
            
            return response
        except Exception as e:
            # Log errors
            logger.error(f"Server error: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail="Internal Server Error")

    # Mount static files for React app
    if os.path.exists("spotizerr-ui/dist"):
        app.mount("/static", StaticFiles(directory="spotizerr-ui/dist"), name="static")
        
        # Serve React App - catch-all route for SPA (but not for API routes)
        @app.get("/{full_path:path}")
        async def serve_react_app(full_path: str):
            """Serve React app with fallback to index.html for SPA routing"""
            static_dir = "spotizerr-ui/dist"
            
            # Don't serve React app for API routes (more specific check)
            if full_path.startswith("api") or full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="API endpoint not found")
            
            # If it's a file that exists, serve it
            if full_path and os.path.exists(os.path.join(static_dir, full_path)):
                return FileResponse(os.path.join(static_dir, full_path))
            else:
                # Fallback to index.html for SPA routing
                return FileResponse(os.path.join(static_dir, "index.html"))
    else:
        logging.warning("React app build directory not found at spotizerr-ui/dist")

    return app


def start_celery_workers():
    """Start Celery workers with dynamic configuration"""
    # This function is now handled by the lifespan context manager
    # and the celery_manager.start() call
    pass


if __name__ == "__main__":
    import uvicorn
    
    app = create_app()
    
    # Run with uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=7171,
        log_level="info",
        access_log=True
    )
