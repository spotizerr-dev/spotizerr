from flask import Blueprint, Response, request
import json
import os
import random
import string
import sys
import traceback
from multiprocessing import Process

playlist_bp = Blueprint('playlist', __name__)

# Global dictionary to track running playlist download processes
playlist_processes = {}

def generate_random_filename(length=6):
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + '.playlist.prg'

class FlushingFileWrapper:
    def __init__(self, file):
        self.file = file

    def write(self, text):
        for line in text.split('\n'):
            line = line.strip()
            # Only process non-empty lines that start with '{'
            if line and line.startswith('{'):
                try:
                    # Try to parse the line as JSON
                    obj = json.loads(line)
                    # If the object has a "type" key with the value "track", skip writing it.
                    if obj.get("type") == "track":
                        continue
                except ValueError:
                    # If the line isn't valid JSON, we don't filter it.
                    pass
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
    
    process = Process(
        target=download_task,
        args=(service, url, main, fallback, quality, fall_quality, real_time, prg_path)
    )
    process.start()
    # Track the running process using the generated filename.
    playlist_processes[filename] = process
    
    return Response(
        json.dumps({"prg_file": filename}),
        status=202,
        mimetype='application/json'
    )

@playlist_bp.route('/download/cancel', methods=['GET'])
def cancel_download():
    """
    Cancel a running playlist download process by its process id (prg file name).
    """
    prg_file = request.args.get('prg_file')
    if not prg_file:
        return Response(
            json.dumps({"error": "Missing process id (prg_file) parameter"}),
            status=400,
            mimetype='application/json'
        )
    
    process = playlist_processes.get(prg_file)
    prg_dir = './prgs'
    prg_path = os.path.join(prg_dir, prg_file)

    if process and process.is_alive():
        # Terminate the running process and wait for it to finish
        process.terminate()
        process.join()
        # Remove it from our tracking dictionary
        del playlist_processes[prg_file]
        
        # Append a cancellation status to the log file
        try:
            with open(prg_path, 'a') as f:
                f.write(json.dumps({"status": "cancel"}) + "\n")
        except Exception as e:
            return Response(
                json.dumps({"error": f"Failed to write cancel status to file: {str(e)}"}),
                status=500,
                mimetype='application/json'
            )
        
        return Response(
            json.dumps({"status": "cancel"}),
            status=200,
            mimetype='application/json'
        )
    else:
        return Response(
            json.dumps({"error": "Process not found or already terminated"}),
            status=404,
            mimetype='application/json'
        )
