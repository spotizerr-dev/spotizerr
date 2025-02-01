from flask import Blueprint, Response, request
import json
import os
import random
import string
import sys
import traceback
from multiprocessing import Process

playlist_bp = Blueprint('playlist', __name__)

def generate_random_filename(length=6):
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + '.prg'

class FlushingFileWrapper:
    def __init__(self, file):
        self.file = file

    def write(self, text):
        for line in text.split('\n'):
            if line.startswith('{'):
                self.file.write(line + '\n')
        self.file.flush()

    def flush(self):
        self.file.flush()

def download_task(service, url, main, fallback, quality, fall_quality, real_time, prg_path):
    try:
        from routes.utils.playlist import download_playlist
        with open(prg_path, 'w') as f:
            flushing_file = FlushingFileWrapper(f)
            original_stdout = sys.stdout
            sys.stdout = flushing_file  # Process-specific stdout
            
            try:
                download_playlist(
                    service=service,
                    url=url,
                    main=main,
                    fallback=fallback,
                    quality=quality,
                    fall_quality=fall_quality,
                    real_time=real_time
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
                sys.stdout = original_stdout  # Restore original stdout
    except Exception as e:
        with open(prg_path, 'w') as f:
            error_data = json.dumps({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()
            })
            f.write(error_data + "\n")

@playlist_bp.route('/download', methods=['GET'])
def handle_download():
    service = request.args.get('service')
    url = request.args.get('url')
    main = request.args.get('main')
    fallback = request.args.get('fallback')
    quality = request.args.get('quality')
    fall_quality = request.args.get('fall_quality')
    
    # Retrieve the real_time parameter from the request query string.
    # Here, if real_time is provided as "true", "1", or "yes" (case-insensitive) it will be interpreted as True.
    real_time_str = request.args.get('real_time', 'false').lower()
    real_time = real_time_str in ['true', '1', 'yes']
    
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
    
    Process(
        target=download_task,
        args=(service, url, main, fallback, quality, fall_quality, real_time, prg_path)
    ).start()
    
    return Response(
        json.dumps({"prg_file": filename}),
        status=202,
        mimetype='application/json'
    )
