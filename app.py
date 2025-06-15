from flask import Flask, request, send_from_directory
from flask_cors import CORS
from routes.search import search_bp
from routes.credentials import credentials_bp
from routes.album import album_bp
from routes.track import track_bp
from routes.playlist import playlist_bp
from routes.prgs import prgs_bp
from routes.config import config_bp
from routes.artist import artist_bp
from routes.history import history_bp
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

# Import Celery configuration and manager
from routes.utils.celery_manager import celery_manager
from routes.utils.celery_config import REDIS_URL
from routes.utils.history_manager import init_history_db


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
    for logger_name in ["werkzeug", "celery", "routes", "flask", "waitress"]:
        module_logger = logging.getLogger(logger_name)
        module_logger.setLevel(logging.INFO)
        # Handlers are inherited from root logger

    # Enable propagation for all loggers
    logging.getLogger("celery").propagate = True

    # Notify successful setup
    root_logger.info("Logging system initialized")

    # Return the main file handler for permissions adjustment
    return file_handler


def check_redis_connection():
    """Check if Redis is reachable and retry with exponential backoff if not"""
    max_retries = 5
    retry_count = 0
    retry_delay = 1  # start with 1 second

    # Extract host and port from REDIS_URL
    redis_host = "redis"  # default
    redis_port = 6379  # default

    # Parse from REDIS_URL if possible
    if REDIS_URL:
        # parse hostname and port (handles optional auth)
        try:
            parsed = urlparse(REDIS_URL)
            if parsed.hostname:
                redis_host = parsed.hostname
            if parsed.port:
                redis_port = parsed.port
        except Exception:
            pass

    # Log Redis connection details
    logging.info(f"Checking Redis connection to {redis_host}:{redis_port}")

    while retry_count < max_retries:
        try:
            # First try socket connection to check if Redis port is open
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((redis_host, redis_port))
            sock.close()

            if result != 0:
                raise ConnectionError(
                    f"Cannot connect to Redis at {redis_host}:{redis_port}"
                )

            # If socket connection successful, try Redis ping
            r = redis.Redis.from_url(REDIS_URL)
            r.ping()
            logging.info("Successfully connected to Redis")
            return True
        except Exception as e:
            retry_count += 1
            if retry_count >= max_retries:
                logging.error(
                    f"Failed to connect to Redis after {max_retries} attempts: {e}"
                )
                logging.error(
                    f"Make sure Redis is running at {redis_host}:{redis_port}"
                )
                return False

            logging.warning(f"Redis connection attempt {retry_count} failed: {e}")
            logging.info(f"Retrying in {retry_delay} seconds...")
            time.sleep(retry_delay)
            retry_delay *= 2  # exponential backoff

    return False


def create_app():
    app = Flask(__name__, static_folder="spotizerr-ui/dist", static_url_path="/")

    # Set up CORS
    CORS(app)

    # Initialize databases
    init_history_db()

    # Register blueprints
    app.register_blueprint(config_bp, url_prefix="/api")
    app.register_blueprint(search_bp, url_prefix="/api")
    app.register_blueprint(credentials_bp, url_prefix="/api/credentials")
    app.register_blueprint(album_bp, url_prefix="/api/album")
    app.register_blueprint(track_bp, url_prefix="/api/track")
    app.register_blueprint(playlist_bp, url_prefix="/api/playlist")
    app.register_blueprint(artist_bp, url_prefix="/api/artist")
    app.register_blueprint(prgs_bp, url_prefix="/api/prgs")
    app.register_blueprint(history_bp, url_prefix="/api/history")

    # Serve React App
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_react_app(path):
        if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        else:
            return send_from_directory(app.static_folder, "index.html")

    # Add request logging middleware
    @app.before_request
    def log_request():
        request.start_time = time.time()
        app.logger.debug(f"Request: {request.method} {request.path}")

    @app.after_request
    def log_response(response):
        if hasattr(request, "start_time"):
            duration = round((time.time() - request.start_time) * 1000, 2)
            app.logger.debug(f"Response: {response.status} | Duration: {duration}ms")
        return response

    # Error logging
    @app.errorhandler(Exception)
    def handle_exception(e):
        app.logger.error(f"Server error: {str(e)}", exc_info=True)
        return "Internal Server Error", 500

    return app


def start_celery_workers():
    """Start Celery workers with dynamic configuration"""
    logging.info("Starting Celery workers with dynamic configuration")
    celery_manager.start()

    # Register shutdown handler
    atexit.register(celery_manager.stop)


if __name__ == "__main__":
    # Configure application logging
    log_handler = setup_logging()

    # Set permissions for log file
    try:
        if os.name != "nt":  # Not Windows
            os.chmod(log_handler.baseFilename, 0o666)
    except Exception as e:
        logging.warning(f"Could not set permissions on log file: {e}")

    # Check Redis connection before starting
    if not check_redis_connection():
        logging.error("Exiting: Could not establish Redis connection.")
        sys.exit(1)

    # Start Celery workers in a separate thread
    start_celery_workers()

    # Clean up Celery workers on exit
    atexit.register(celery_manager.stop)

    # Create Flask app
    app = create_app()

    # Get host and port from environment variables or use defaults
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 7171))

    # Use Flask's built-in server for development
    # logging.info(f"Starting Flask development server on http://{host}:{port}")
    # app.run(host=host, port=port, debug=True)

    # The following uses Waitress, a production-ready server.
    # To use it, comment out the app.run() line above and uncomment the lines below.
    logging.info(f"Starting server with Waitress on http://{host}:{port}")
    from waitress import serve
    serve(app, host=host, port=port)
