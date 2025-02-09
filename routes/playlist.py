from flask import Blueprint, Response, request
import os
import json
import traceback
from routes.utils.queue import download_queue_manager

playlist_bp = Blueprint('playlist', __name__)

@playlist_bp.route('/download', methods=['GET'])
def handle_download():
    # Retrieve parameters from the request.
    service = request.args.get('service')
    url = request.args.get('url')
    main = request.args.get('main')
    fallback = request.args.get('fallback')
    quality = request.args.get('quality')
    fall_quality = request.args.get('fall_quality')
    
    # Normalize the real_time parameter; default to False.
    real_time_arg = request.args.get('real_time', 'false')
    real_time = real_time_arg.lower() in ['true', '1', 'yes']
    
    # New custom formatting parameters (with defaults)
    custom_dir_format = request.args.get('custom_dir_format', "%ar_album%/%album%/%copyright%")
    custom_track_format = request.args.get('custom_track_format', "%tracknum%. %music% - %artist%")
    
    # Sanitize main and fallback to prevent directory traversal.
    if main:
        main = os.path.basename(main)
    if fallback:
        fallback = os.path.basename(fallback)
    
    if not all([service, url, main]):
        return Response(
            json.dumps({"error": "Missing parameters"}),
            status=400,
            mimetype='application/json'
        )
    
    # Build the task dictionary.
    # Note: the key "download_type" tells the queue handler which download function to call.
    task = {
        "download_type": "playlist",
        "service": service,
        "url": url,
        "main": main,
        "fallback": fallback,
        "quality": quality,
        "fall_quality": fall_quality,
        "real_time": real_time,
        "custom_dir_format": custom_dir_format,
        "custom_track_format": custom_track_format,
        "orig_request": request.args.to_dict(),
        # If provided, these additional parameters can be used by your download function.
        "type": "playlist",
        "name": request.args.get('name'),
        "artist": request.args.get('artist')
    }
    
    # Add the task to the queue and get the generated process (prg) filename.
    prg_filename = download_queue_manager.add_task(task)
    
    return Response(
        json.dumps({"prg_file": prg_filename}),
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
