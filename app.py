from flask import Flask, request, send_from_directory, render_template
from flask_cors import CORS
from routes.search import search_bp
from routes.credentials import credentials_bp
from routes.album import album_bp
from routes.track import track_bp
from routes.playlist import playlist_bp
from routes.prgs import prgs_bp
from routes.config import config_bp
from routes.artist import artist_bp
import logging
import logging.handlers
import time
from pathlib import Path
import os
import atexit
import sys

# Import Celery configuration and manager
from routes.utils.celery_tasks import celery_app
from routes.utils.celery_manager import celery_manager

# Configure application-wide logging
def setup_logging():
    """Configure application-wide logging with rotation"""
    # Create logs directory if it doesn't exist
    logs_dir = Path('logs')
    logs_dir.mkdir(exist_ok=True)
    
    # Set up log file paths
    main_log = logs_dir / 'spotizerr.log'
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    
    # Log formatting
    log_format = logging.Formatter(
        '%(asctime)s [%(processName)s:%(threadName)s] [%(name)s] [%(levelname)s] - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # File handler with rotation (10 MB max, keep 5 backups)
    file_handler = logging.handlers.RotatingFileHandler(
        main_log, maxBytes=10*1024*1024, backupCount=5, encoding='utf-8'
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
    for logger_name in ['werkzeug', 'celery', 'routes', 'flask', 'waitress']:
        module_logger = logging.getLogger(logger_name)
        module_logger.setLevel(logging.INFO)
        # Handlers are inherited from root logger
    
    # Enable propagation for all loggers
    logging.getLogger('celery').propagate = True
    
    # Notify successful setup
    root_logger.info("Logging system initialized")
    
    # Return the main file handler for permissions adjustment
    return file_handler

def create_app():
    app = Flask(__name__)
    
    # Set up CORS
    CORS(app)

    # Register blueprints
    app.register_blueprint(config_bp, url_prefix='/api')
    app.register_blueprint(search_bp, url_prefix='/api')
    app.register_blueprint(credentials_bp, url_prefix='/api/credentials')
    app.register_blueprint(album_bp, url_prefix='/api/album')
    app.register_blueprint(track_bp, url_prefix='/api/track') 
    app.register_blueprint(playlist_bp, url_prefix='/api/playlist')
    app.register_blueprint(artist_bp, url_prefix='/api/artist')
    app.register_blueprint(prgs_bp, url_prefix='/api/prgs')  
    
    # Serve frontend
    @app.route('/')
    def serve_index():
        return render_template('main.html')

    # Config page route
    @app.route('/config')
    def serve_config():
        return render_template('config.html')

    # New route: Serve playlist.html under /playlist/<id>
    @app.route('/playlist/<id>')
    def serve_playlist(id):
        # The id parameter is captured, but you can use it as needed.
        return render_template('playlist.html')
        # New route: Serve playlist.html under /playlist/<id>
    @app.route('/album/<id>')
    def serve_album(id):
        # The id parameter is captured, but you can use it as needed.
        return render_template('album.html')

    @app.route('/track/<id>')
    def serve_track(id):
        # The id parameter is captured, but you can use it as needed.
        return render_template('track.html')
    
    @app.route('/artist/<id>')
    def serve_artist(id):
        # The id parameter is captured, but you can use it as needed.
        return render_template('artist.html')

    @app.route('/static/<path:path>')
    def serve_static(path):
        return send_from_directory('static', path)

    # Serve favicon.ico from the same directory as index.html (templates)
    @app.route('/favicon.ico')
    def serve_favicon():
        return send_from_directory('templates', 'favicon.ico')

    # Add request logging middleware
    @app.before_request
    def log_request():
        request.start_time = time.time()
        app.logger.debug(f"Request: {request.method} {request.path}")

    @app.after_request
    def log_response(response):
        if hasattr(request, 'start_time'):
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

if __name__ == '__main__':
    # Configure application logging
    log_handler = setup_logging()
    
    # Set file permissions for log files if needed
    try:
        os.chmod(log_handler.baseFilename, 0o666)
    except:
        logging.warning("Could not set permissions on log file")
    
    # Log application startup
    logging.info("=== Spotizerr Application Starting ===")
    
    # Start Celery workers
    start_celery_workers()
    
    # Create and start Flask app
    app = create_app()
    logging.info("Starting Flask server on port 7171")
    from waitress import serve
    serve(app, host='0.0.0.0', port=7171)
