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
import time
from pathlib import Path
import os

def create_app():
    app = Flask(__name__)
    
    # Configure basic logging
    log_file = 'flask_server.log'
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(name)s %(threadName)s : %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler()
        ]
    )
    
    os.chmod(log_file, 0o666)

    # Get Flask's logger
    logger = logging.getLogger('werkzeug')
    logger.setLevel(logging.INFO)

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
        logger.info(f"Request: {request.method} {request.path}")

    @app.after_request
    def log_response(response):
        duration = round((time.time() - request.start_time) * 1000, 2)
        logger.info(f"Response: {response.status} | Duration: {duration}ms")
        return response

    # Error logging
    @app.errorhandler(Exception)
    def handle_exception(e):
        logger.error(f"Server error: {str(e)}", exc_info=True)
        return "Internal Server Error", 500

    return app

if __name__ == '__main__':
    # Configure waitress logger
    logger = logging.getLogger('waitress')
    logger.setLevel(logging.INFO)
    
    app = create_app()
    logging.info("Starting Flask server on port 7171")
    from waitress import serve
    serve(app, host='0.0.0.0', port=7171)
