from flask import Blueprint, Response, request
import json
import os
import random
import string
import sys
from threading import Thread
import traceback

track_bp = Blueprint('track', __name__)

def generate_random_filename(length=6):
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + '.prg'

class FlushingFileWrapper:
    def __init__(self, file):
        self.file = file

    def write(self, text):
        self.file.write(text)
        self.file.flush()

    def flush(self):
        self.file.flush()

@track_bp.route('/download', methods=['GET'])
def handle_download():
    service = request.args.get('service')
    url = request.args.get('url')
    main = request.args.get('main')
    fallback = request.args.get('fallback')  # New fallback parameter
    
    if not all([service, url, main]):
        return Response(
            json.dumps({"error": "Missing parameters"}),
            status=400,
            mimetype='application/json'
        )
    
    filename = generate_random_filename()
    prg_dir = './prgs'
    os.makedirs(prg_dir, exist_ok=True)
    prg_path = os.path.join(prg_dir, filename)
    
    def download_task():
        try:
            from routes.utils.track import download_track
            with open(prg_path, 'w') as f:
                flushing_file = FlushingFileWrapper(f)
                original_stdout = sys.stdout
                sys.stdout = flushing_file
                
                try:
                    # Pass all parameters including fallback
                    download_track(
                        service=service,
                        url=url,
                        main=main,
                        fallback=fallback
                    )
                    flushing_file.write(json.dumps({"status": "complete"}) + "\n")
                except Exception as e:
                    error_data = json.dumps({
                        "status": "error",
                        "message": str(e),
                        "traceback": traceback.format_exc()
                    })
                    flushing_file.write(error_data + "\n")
                finally:
                    sys.stdout = original_stdout
        except Exception as e:
            with open(prg_path, 'w') as f:
                error_data = json.dumps({
                    "status": "error",
                    "message": str(e),
                    "traceback": traceback.format_exc()
                })
                f.write(error_data + "\n")
    
    Thread(target=download_task).start()
    
    return Response(
        json.dumps({"prg_file": filename}),
        status=202,
        mimetype='application/json'
    )