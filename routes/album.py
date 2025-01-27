from flask import Blueprint, Response, request
import json
import os
import random
import string
import sys
import traceback
from multiprocessing import Process  # Use multiprocessing instead of threading

# Define the Blueprint for album-related routes
album_bp = Blueprint('album', __name__)

# Function to generate random filenames
def generate_random_filename(length=6):
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + '.prg'

# File wrapper to flush writes immediately
class FlushingFileWrapper:
    def __init__(self, file):
        self.file = file

    def write(self, text):
        self.file.write(text)
        self.file.flush()

    def flush(self):
        self.file.flush()

# Define the download task as a top-level function for picklability
def download_task(service, url, main, fallback, prg_path):
    try:
        from routes.utils.album import download_album
        with open(prg_path, 'w') as f:
            flushing_file = FlushingFileWrapper(f)
            original_stdout = sys.stdout
            sys.stdout = flushing_file  # Redirect stdout to the file
            try:
                # Execute the download process
                download_album(
                    service=service,
                    url=url,
                    main=main,
                    fallback=fallback
                )
                flushing_file.write(json.dumps({"status": "complete"}) + "\n")
            except Exception as e:
                # Capture exceptions and write to file
                error_data = json.dumps({
                    "status": "error",
                    "message": str(e),
                    "traceback": traceback.format_exc()
                })
                flushing_file.write(error_data + "\n")
            finally:
                sys.stdout = original_stdout  # Restore original stdout
    except Exception as e:
        # Handle exceptions that occur outside the main download process
        with open(prg_path, 'w') as f:
            error_data = json.dumps({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()
            })
            f.write(error_data + "\n")

# Define the route to handle album download requests
@album_bp.route('/download', methods=['GET'])
def handle_download():
    # Extract query parameters
    service = request.args.get('service')
    url = request.args.get('url')
    main = request.args.get('main')
    fallback = request.args.get('fallback')  # Optional parameter

    # Validate required parameters
    if not all([service, url, main]):
        return Response(
            json.dumps({"error": "Missing parameters"}),
            status=400,
            mimetype='application/json'
        )

    # Generate a unique file for storing the download progress
    filename = generate_random_filename()
    prg_dir = './prgs'
    os.makedirs(prg_dir, exist_ok=True)
    prg_path = os.path.join(prg_dir, filename)

    # Start a new process for each download task
    Process(
        target=download_task,
        args=(service, url, main, fallback, prg_path)
    ).start()

    # Return the filename to the client for progress tracking
    return Response(
        json.dumps({"prg_file": filename}),
        status=202,
        mimetype='application/json'
    )