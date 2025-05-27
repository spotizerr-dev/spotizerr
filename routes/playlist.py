from flask import Blueprint, Response, request
import os
import json
import traceback
import uuid # For generating error task IDs
import time # For timestamps
from routes.utils.celery_queue_manager import download_queue_manager
from routes.utils.celery_tasks import store_task_info, store_task_status, ProgressState # For error task creation

playlist_bp = Blueprint('playlist', __name__)

@playlist_bp.route('/download', methods=['GET'])
def handle_download():
    # Retrieve essential parameters from the request.
    url = request.args.get('url')
    name = request.args.get('name')
    artist = request.args.get('artist')
    orig_params = request.args.to_dict()
    orig_params["original_url"] = request.url
    
    # Validate required parameters
    if not url:
        return Response(
            json.dumps({"error": "Missing required parameter: url"}),
            status=400, 
            mimetype='application/json'
        )
    
    try:
        task_id = download_queue_manager.add_task({
            "download_type": "playlist",
            "url": url,
            "name": name,
            "artist": artist,
            "orig_request": orig_params
        })
    # Removed DuplicateDownloadError handling, add_task now manages this by creating an error task.
    except Exception as e:
        # Generic error handling for other issues during task submission
        error_task_id = str(uuid.uuid4())
        store_task_info(error_task_id, {
            "download_type": "playlist",
            "url": url,
            "name": name,
            "artist": artist,
            "original_request": orig_params,
            "created_at": time.time(),
            "is_submission_error_task": True
        })
        store_task_status(error_task_id, {
            "status": ProgressState.ERROR,
            "error": f"Failed to queue playlist download: {str(e)}",
            "timestamp": time.time()
        })
        return Response(
            json.dumps({"error": f"Failed to queue playlist download: {str(e)}", "task_id": error_task_id}),
            status=500,
            mimetype='application/json'
        )
    
    return Response(
        json.dumps({"prg_file": task_id}), # prg_file is the old name for task_id
        status=202,
        mimetype='application/json'
    )

@playlist_bp.route('/download/cancel', methods=['GET'])
def cancel_download():
    """
    Cancel a running playlist download process by its prg file name.
    """
    prg_file = request.args.get('prg_file')
    if not prg_file:
        return Response(
            json.dumps({"error": "Missing process id (prg_file) parameter"}),
            status=400,
            mimetype='application/json'
        )
    
    # Use the queue manager's cancellation method.
    result = download_queue_manager.cancel_task(prg_file)
    status_code = 200 if result.get("status") == "cancelled" else 404
    
    return Response(
        json.dumps(result),
        status=status_code,
        mimetype='application/json'
    )

@playlist_bp.route('/info', methods=['GET'])
def get_playlist_info():
    """
    Retrieve Spotify playlist metadata given a Spotify playlist ID.
    Expects a query parameter 'id' that contains the Spotify playlist ID.
    """
    spotify_id = request.args.get('id')
    
    if not spotify_id:
        return Response(
            json.dumps({"error": "Missing parameter: id"}),
            status=400,
            mimetype='application/json'
        )
    
    try:
        # Import and use the get_spotify_info function from the utility module.
        from routes.utils.get_info import get_spotify_info
        playlist_info = get_spotify_info(spotify_id, "playlist")
        return Response(
            json.dumps(playlist_info),
            status=200,
            mimetype='application/json'
        )
    except Exception as e:
        error_data = {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        return Response(
            json.dumps(error_data),
            status=500,
            mimetype='application/json'
        )
