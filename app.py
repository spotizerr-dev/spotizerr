from flask import Flask
from flask_cors import CORS
from routes.search import search_bp
from routes.credentials import credentials_bp

def create_app():
    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(search_bp, url_prefix='/api')
    app.register_blueprint(credentials_bp, url_prefix='/api/credentials')
    return app

if __name__ == '__main__':
    from waitress import serve
    app = create_app()
    serve(app, host='0.0.0.0', port=5000)