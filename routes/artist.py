#!/usr/bin/env python3
"""
Artist endpoint blueprint.
"""

from flask import Blueprint, Response, request
import json
import os
import traceback
from routes.utils.celery_queue_manager import download_queue_manager

artist_bp = Blueprint('artist', __name__)

def log_json(message_dict):
    print(json.dumps(message_dict))


@artist_bp.route('/download', methods=['GET'])
def handle_artist_download():
    """
    Enqueues album download tasks for the given artist.
    Expected query parameters:
      - url: string (a Spotify artist URL)
      - album_type: string(s); comma-separated values such as "album,single,appears_on,compilation"
    """
    # Retrieve essential parameters from the request.
    url = request.args.get('url')
    album_type = request.args.get('album_type', "album,single,compilation")
    
    # Validate required parameters
    if not url:
        return Response(
            json.dumps({"error": "Missing required parameter: url"}),
            status=400,
            mimetype='application/json'
        )

    try:
        # Import and call the updated download_artist_albums() function.
        from routes.utils.artist import download_artist_albums
        
        # Delegate to the download_artist_albums function which will handle album filtering
        task_ids = download_artist_albums(
            url=url,
            album_type=album_type,
            request_args=request.args.to_dict()
        )
        
        # Return the list of album task IDs.
        return Response(
            json.dumps({
                "status": "complete",
                "task_ids": task_ids,
                "message": f"Artist download completed – {len(task_ids)} album tasks have been queued."
            }),
            status=202,
            mimetype='application/json'
        )
    except Exception as e:
        return Response(
            json.dumps({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()
            }),
            status=500,
            mimetype='application/json'
        )


@artist_bp.route('/download/cancel', methods=['GET'])
def cancel_artist_download():
    """
    Cancelling an artist download is not supported since the endpoint only enqueues album tasks.
    (Cancellation for individual album tasks can be implemented via the queue manager.)
    """
    return Response(
        json.dumps({"error": "Artist download cancellation is not supported."}),
        status=400,
        mimetype='application/json'
    )


@artist_bp.route('/info', methods=['GET'])
def get_artist_info():
    """
    Retrieves Spotify artist metadata given a Spotify artist ID.
    Expects a query parameter 'id' with the Spotify artist ID.
    """
    spotify_id = request.args.get('id')
    
    if not spotify_id:
        return Response(
            json.dumps({"error": "Missing parameter: id"}),
            status=400,
            mimetype='application/json'
        )
    
    try:
        from routes.utils.get_info import get_spotify_info
        artist_info = get_spotify_info(spotify_id, "artist")
        return Response(
            json.dumps(artist_info),
            status=200,
            mimetype='application/json'
        )
    except Exception as e:
        return Response(
            json.dumps({
                "error": str(e),
                "traceback": traceback.format_exc()
            }),
            status=500,
            mimetype='application/json'
        )
