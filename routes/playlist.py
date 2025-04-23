from flask import Blueprint, Response, request
import os
import json
import traceback
from routes.utils.celery_queue_manager import download_queue_manager

playlist_bp = Blueprint('playlist', __name__)

@playlist_bp.route('/download', methods=['GET'])
def handle_download():
    # Retrieve essential parameters from the request.
    url = request.args.get('url')
    name = request.args.get('name')
    artist = request.args.get('artist')
    
    # Validate required parameters
    if not url:
        return Response(
            json.dumps({"error": "Missing required parameter: url"}),
            status=400, 
            mimetype='application/json'
        )
    
    # Add the task to the queue with only essential parameters
    # The queue manager will now handle all config parameters
    # Include full original request URL in metadata
    orig_params = request.args.to_dict()
    orig_params["original_url"] = request.url
    task_id = download_queue_manager.add_task({
        "download_type": "playlist",
        "url": url,
        "name": name,
        "artist": artist,
        "orig_request": orig_params
    })
    
    return Response(
        json.dumps({"prg_file": task_id}),
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
